import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  CHANGE_MANIFEST_SCHEMA,
  cleanupIntegrationWorktree,
  DEVICE_INTEGRATION_RESULT_SCHEMA,
  WORKTREE_CLEANUP_RESULT_SCHEMA,
  integrateSession,
  renderManagedCommitMessage,
  resolveRuntimeRepositories,
  validateIntegrationCleanupReceipt,
} from "../scripts/device-integrate-lib.mjs";
import {
  CLOUD_COLLABORATION_BOUNDS,
  digestValue,
} from "../scripts/cloud-collaboration-primitives.mjs";
import { normalizeDeclaredWriteScopeManifest } from "../scripts/scoped-lane-admission-lib.mjs";
import { casWriterLeaseProjection } from "../scripts/writer-lease-registry-cas.mjs";
import { createWriterLeaseStore } from "../scripts/writer-lease-lib.mjs";
import { createWorktreeCleanupOperationId } from "../scripts/worktree-lifecycle-lib.mjs";
import { deriveTaskWorktreeContainers } from "../scripts/task-worktree-owned-containers.mjs";

const branch = "agent/device/runtime-integration";
const baseSha = "a".repeat(40);
const fenceSha = "b".repeat(40);
const commitSha = "c".repeat(40);
const treeSha = "d".repeat(40);
const mergeSha = "e".repeat(40);
const mainSha = "f".repeat(40);
const knowgrphSha = "1".repeat(40);
const pullRequestUrl = "https://github.test/example/repo/pull/42";
const githubPullRequestUrl = "https://github.com/example/repo/pull/42";
const claimId = "8".repeat(64);
const claimDigest = "9".repeat(64);
const ledgerRevision = "8".repeat(40);
const transitionCounter = 5;
const targetMainSha = "0".repeat(40);
const pullRequestNodeId = "PR_42";
const autoMergeActorDatabaseId = 8_945_812;
const autoMergeActorNodeId = "MDQ6VXNlcjg5NDU4MTI=";
const autoMergeActorLogin = "huijoohwee";
const autoMergeActorType = "User";
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

function cleanupReceipt({
  worktreePath,
  repository = path.join(worktreePath, "canonical", "agentic-canvas-os"),
  gitCommonDir = path.join(repository, ".git"),
  canonicalSha = mainSha,
  status = "cleaned",
  kind,
  managedDisposition,
  sharedDisposition,
  receiptOverrides = {},
} = {}) {
  const ownership = deriveTaskWorktreeContainers({ repoRoot: repository, gitCommonDir, targetPath: worktreePath });
  const receiptKind = kind || ownership.kind;
  const managedRoot = ownership.managedContainer.root;
  const sharedRoot = ownership.sharedContainer.root;
  const finalManagedDisposition = managedDisposition ||
    (receiptKind === "managed" ? "removed-empty" : "not-managed");
  const finalSharedDisposition = sharedDisposition ||
    (receiptKind === "managed" ? "removed-empty" : "not-managed");
  const cleaned = status === "cleaned";
  const receipt = {
    schema: WORKTREE_CLEANUP_RESULT_SCHEMA,
    status,
    repository,
    gitCommonDir,
    canonicalSha,
    target: {
      path: worktreePath,
      registeredBefore: cleaned,
      pathPresentBefore: cleaned,
      registeredAfter: false,
      pathExistsAfter: false,
      head: cleaned ? canonicalSha : null,
      completionMainSha: canonicalSha,
      state: cleaned ? "cleanup-ready" : "already-cleaned",
    },
    removedWorktree: cleaned ? worktreePath : null,
    preservedBranch: branch,
    registrationPruned: false,
    kind: receiptKind,
    managedContainer: { root: managedRoot, disposition: finalManagedDisposition },
    sharedContainer: { root: sharedRoot, disposition: finalSharedDisposition },
    removedEmptyDirectories: [
      ...(finalManagedDisposition === "removed-empty" ? [managedRoot] : []),
      ...(finalSharedDisposition === "removed-empty" ? [sharedRoot] : []),
    ],
    replayed: !cleaned,
  };
  receipt.operationId = createWorktreeCleanupOperationId({
    repository,
    gitCommonDir,
    targetPath: worktreePath,
    completionMainSha: canonicalSha,
    preservedBranch: branch,
    managedContainer: receipt.managedContainer,
    sharedContainer: receipt.sharedContainer,
  });
  return { ...receipt, ...receiptOverrides };
}

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
  const knowgrphRoot = path.join(workspace, "knowgrph");
  mkdirSync(isolatedCanonicalRoot, { recursive: true });
  mkdirSync(agenticCanvasOsRoot, { recursive: true });
  mkdirSync(knowgrphRoot, { recursive: true });
  writeFileSync(path.join(isolatedCanonicalRoot, "package.json"), JSON.stringify({ private: true }));
  writeFileSync(
    path.join(agenticCanvasOsRoot, "package.json"),
    JSON.stringify({ name: "agentic-canvas-os" }),
  );
  writeFileSync(path.join(knowgrphRoot, "package.json"), JSON.stringify({ name: "knowgrph" }));

  try {
    assert.deepEqual(resolveRuntimeRepositories({
      canonicalRoot: isolatedCanonicalRoot,
      controllerRoot: path.join(workspace, "ignored-controller-root"),
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
    writeFileSync(
      path.join(isolatedCanonicalRoot, "package.json"),
      JSON.stringify({ name: "huijoohwee.github.io" }),
    );
    assert.deepEqual(resolveRuntimeRepositories({
      canonicalRoot: isolatedCanonicalRoot,
      controllerRoot: agenticCanvasOsRoot,
      runtimeRepository: knowgrphRoot,
      allowAncillary: true,
      readOriginRemote: () => "https://github.com/huijoohwee/huijoohwee.github.io.git",
    }), {
      integratedRepository: "huijoohwee.github.io",
      agenticCanvasOsRoot,
      knowgrphRoot,
    });
    assert.throws(() => resolveRuntimeRepositories({
      canonicalRoot: isolatedCanonicalRoot,
      controllerRoot: agenticCanvasOsRoot,
      allowAncillary: true,
      readOriginRemote: () => "https://github.com/huijoohwee/huijoohwee.github.io.git",
    }), /requires an explicit absolute Knowgrph repository/u);
    rmSync(knowgrphRoot, { recursive: true, force: true });
    assert.deepEqual(resolveRuntimeRepositories({
      canonicalRoot: isolatedCanonicalRoot,
      controllerRoot: agenticCanvasOsRoot,
      allowAncillary: true,
      runtimeRequired: false,
      readOriginRemote: () => "https://github.com/huijoohwee/huijoohwee.github.io.git",
    }), {
      integratedRepository: "huijoohwee.github.io",
      agenticCanvasOsRoot,
      knowgrphRoot,
    });
    assert.throws(() => resolveRuntimeRepositories({
      canonicalRoot: isolatedCanonicalRoot,
      controllerRoot: agenticCanvasOsRoot,
      runtimeRepository: knowgrphRoot,
      allowAncillary: true,
      readOriginRemote: () => "https://github.com/example/different-repository.git",
    }), /Unsupported canonical integration repository identity/u);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});

test("cleanup validation accepts safe retained containers and preserves the typed receipt", () => {
  const repository = "/workspace/agentic-canvas-os";
  const worktreePath = "/workspace/.worktrees/agentic-canvas-os/runtime-integration";
  const receipt = cleanupReceipt({
    repository,
    worktreePath,
    kind: "managed",
    managedDisposition: "retained-nonempty",
    sharedDisposition: "not-attempted",
    receiptOverrides: { canonicalSha: "8".repeat(40) },
  });
  assert.strictEqual(validateIntegrationCleanupReceipt({
    receipt,
    repository,
    completionMainSha: mainSha,
    expectedGitCommonDir: receipt.gitCommonDir,
    integrationBranch: branch,
    integrationWorktree: worktreePath,
  }), receipt);

  const replay = cleanupReceipt({
    repository,
    worktreePath: "/workspace/external/runtime-integration",
    status: "already-cleaned",
  });
  assert.strictEqual(validateIntegrationCleanupReceipt({
    receipt: replay,
    repository,
    completionMainSha: mainSha,
    expectedGitCommonDir: replay.gitCommonDir,
    integrationBranch: branch,
    integrationWorktree: replay.target.path,
  }), replay);

  const identityDrift = cleanupReceipt({
    repository,
    worktreePath,
    kind: "managed",
    managedDisposition: "retained-ambiguous",
    sharedDisposition: "retained-ambiguous",
  });
  assert.strictEqual(validateIntegrationCleanupReceipt({
    receipt: identityDrift,
    repository,
    completionMainSha: mainSha,
    expectedGitCommonDir: identityDrift.gitCommonDir,
    integrationBranch: branch,
    integrationWorktree: worktreePath,
  }), identityDrift);
});

test("cleanup validation rejects legacy, inexact, pruned, and unsafe receipts", () => {
  const repository = "/workspace/agentic-canvas-os";
  const worktreePath = "/workspace/external/runtime-integration";
  const valid = cleanupReceipt({ repository, worktreePath });
  const validate = receipt => validateIntegrationCleanupReceipt({
    receipt,
    repository,
    completionMainSha: mainSha,
    expectedGitCommonDir: valid.gitCommonDir,
    integrationBranch: branch,
    integrationWorktree: worktreePath,
  });
  for (const receipt of [
    { ...valid, schema: "agentic-worktree-lifecycle-report/v1" },
    { ...valid, status: "already_cleaned" },
    { ...valid, registrationPruned: true },
    { ...valid, preservedBranch: "agent/device/other" },
    { ...valid, target: { ...valid.target, path: "/workspace/external/other" } },
    { ...valid, target: { ...valid.target, registeredAfter: true } },
    { ...valid, target: { ...valid.target, pathExistsAfter: true } },
    { ...valid, removedWorktree: null },
  ]) {
    assert.throws(() => validate(receipt), /exact target removal or absence evidence/u);
  }

  assert.throws(() => validate({
    ...valid,
    managedContainer: { ...valid.managedContainer, disposition: "removed-empty" },
    removedEmptyDirectories: [valid.managedContainer.root],
  }), /safe container dispositions/u);
  assert.throws(() => validate({
    ...valid,
    managedContainer: { root: "/outside/.worktrees/fake", disposition: "not-managed" },
    sharedContainer: { root: "/outside/.worktrees", disposition: "not-managed" },
  }), /safe container dispositions/u);
  assert.throws(() => validate({
    ...valid,
    operationId: "0".repeat(64),
  }), /operation identity does not match/u);

  const fabricatedGitCommonDir = "/outside/fake/.git";
  const fabricatedOwnership = deriveTaskWorktreeContainers({
    repoRoot: repository,
    gitCommonDir: fabricatedGitCommonDir,
    targetPath: worktreePath,
  });
  const fabricated = {
    ...valid,
    gitCommonDir: fabricatedGitCommonDir,
    kind: fabricatedOwnership.kind,
    managedContainer: {
      root: fabricatedOwnership.managedContainer.root,
      disposition: "not-managed",
    },
    sharedContainer: {
      root: fabricatedOwnership.sharedContainer.root,
      disposition: "not-managed",
    },
    removedEmptyDirectories: [],
  };
  fabricated.operationId = createWorktreeCleanupOperationId({
    repository,
    gitCommonDir: fabricatedGitCommonDir,
    targetPath: worktreePath,
    completionMainSha: mainSha,
    preservedBranch: branch,
    managedContainer: fabricated.managedContainer,
    sharedContainer: fabricated.sharedContainer,
  });
  assert.throws(() => validate(fabricated), /Git common-directory evidence changed/u);
});

test("cleanup child retries one absent response and accepts the same-command replay", () => {
  const repository = "/workspace/agentic-canvas-os";
  const worktreePath = "/workspace/external/runtime-integration";
  const receipt = cleanupReceipt({ repository, worktreePath, status: "already-cleaned" });
  const nodeCalls = [];
  const outputs = ["", JSON.stringify(receipt)];
  const result = cleanupIntegrationWorktree({
    canonicalIntegration: {
      integratedSource: { root: repository, mainSha },
      repositories: { agenticCanvasOsRoot: repository },
    },
    integrationBranch: branch,
    integrationWorktree: worktreePath,
    runText: (command, args, options) => {
      if (command === "git" && args.join(" ") === "rev-parse --git-common-dir") return ".git\n";
      if (command === "node") {
        nodeCalls.push({ args, options });
        return outputs.shift();
      }
      throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
    },
  });
  assert.deepEqual(result, receipt);
  assert.equal(nodeCalls.length, 2);
  assert.deepEqual(nodeCalls[1], nodeCalls[0]);
});

test("cleanup child does not retry a parseable invalid receipt", () => {
  const repository = "/workspace/agentic-canvas-os";
  const worktreePath = "/workspace/external/runtime-integration";
  const invalidReceipt = {
    ...cleanupReceipt({ repository, worktreePath }),
    schema: "invalid-cleanup-result",
  };
  let nodeCalls = 0;
  assert.throws(() => cleanupIntegrationWorktree({
    canonicalIntegration: {
      integratedSource: { root: repository, mainSha },
      repositories: { agenticCanvasOsRoot: repository },
    },
    integrationBranch: branch,
    integrationWorktree: worktreePath,
    runText: (command, args) => {
      if (command === "git" && args.join(" ") === "rev-parse --git-common-dir") return ".git\n";
      nodeCalls += 1;
      return JSON.stringify(invalidReceipt);
    },
  }), /exact target removal or absence evidence/u);
  assert.equal(nodeCalls, 1);
});

test("cleanup child reports two unparseable responses after one bounded retry", () => {
  const repository = "/workspace/agentic-canvas-os";
  const worktreePath = "/workspace/external/runtime-integration";
  let nodeCalls = 0;
  assert.throws(() => cleanupIntegrationWorktree({
    canonicalIntegration: {
      integratedSource: { root: repository, mainSha },
      repositories: { agenticCanvasOsRoot: repository },
    },
    integrationBranch: branch,
    integrationWorktree: worktreePath,
    runText: (command, args) => {
      if (command === "git" && args.join(" ") === "rev-parse --git-common-dir") return ".git\n";
      nodeCalls += 1;
      return nodeCalls === 1 ? "not-json" : "{still-not-json";
    },
  }), /no machine-readable result after one bounded retry/u);
  assert.equal(nodeCalls, 2);
});

test("ancillary source-only completion needs no Knowgrph checkout", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-ancillary-source-only-"));
  const canonicalAncillaryRoot = path.join(repo, "canonical", "huijoohwee.github.io");
  const canonicalAgenticRoot = path.join(repo, "controller", "agentic-canvas-os");
  mkdirSync(canonicalAncillaryRoot, { recursive: true });
  mkdirSync(canonicalAgenticRoot, { recursive: true });
  writeFileSync(
    path.join(canonicalAncillaryRoot, "package.json"),
    JSON.stringify({ name: "huijoohwee.github.io" }),
  );
  writeFileSync(path.join(canonicalAgenticRoot, "package.json"), JSON.stringify({ name: "agentic-canvas-os" }));
  const lease = createLease({
    repo,
    status: "completed",
    completion: { mergeCommitSha: mergeSha, mainSha },
  });
  const cleanup = cleanupReceipt({
    repository: canonicalAncillaryRoot,
    worktreePath: repo,
    status: "already-cleaned",
  });
  const commands = [];
  try {
    const result = integrateSession({
      invocationPath: repo,
      repo,
      gitText: args => {
        const key = args.join(" ");
        if (key === "branch --show-current") return branch;
        if (key === "worktree list --porcelain -z") {
          return canonicalWorktree(repo, "huijoohwee.github.io");
        }
        throw new Error(`unexpected git command: ${key}`);
      },
      ghText: () => { throw new Error("completed replay must not query GitHub"); },
      leaseStore: { read: requested => requested ? lease : { leases: { [branch]: lease } } },
      sessionId: "session-a",
      run: () => { throw new Error("completed replay must not mutate through run"); },
      runText: (command, args, options = {}) => {
        commands.push({ command, args, options });
        if (command === "node" && args[0].endsWith("live-sync.mjs") &&
            options.cwd === canonicalAncillaryRoot) return "";
        if (command === "git" && args.join(" ") === "rev-parse --git-common-dir") {
          return ".git\n";
        }
        if (command === "git" && args.join(" ") === "rev-parse HEAD" &&
            options.cwd === canonicalAncillaryRoot) return `${mainSha}\n`;
        if (command === "git" && args.join(" ") === "remote get-url origin" &&
            options.cwd === canonicalAncillaryRoot) {
          return "https://github.com/huijoohwee/huijoohwee.github.io.git\n";
        }
        if (command === "node" && args[0].endsWith("worktree-lifecycle.mjs") &&
            options.cwd === canonicalAgenticRoot) {
          return JSON.stringify(cleanup);
        }
        throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
      },
      publishTask: () => { throw new Error("completed replay must not publish"); },
      completeTask: () => { throw new Error("completed replay must not complete twice"); },
      runtime: "none",
      controllerRoot: canonicalAgenticRoot,
      waitSeconds: 1,
      pollSeconds: 0.1,
      log: () => {},
    });

    assert.equal(result.status, "integrated");
    assert.equal(result.canonical.repository, "huijoohwee.github.io");
    assert.deepEqual(result.cleanup, cleanup);
    assert.equal(commands.some(({ command }) => command === "npm"), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
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
  const managedCommitSubject = "feat(runtime-integration): integrate the canonical runtime";
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
        if (command === "git" && args.join(" ") === "rev-parse --git-common-dir") {
          return ".git\n";
        }
        if (command === "git") return `${mainSha}\n`;
        if (command === "node" && args[0].endsWith("worktree-lifecycle.mjs")) {
          return JSON.stringify(cleanupReceipt({
            repository: canonicalAgenticRoot,
            worktreePath: repo,
          }));
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
      commitMessage: managedCommitSubject,
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
      "git commit -m feat(runtime-integration): integrate the canonical runtime " +
      "-m Integrate the declared runtime-integration change through its protected managed task lane so downstream policy can attribute the change to its writer lease. " +
      "-m Agentic-Task: runtime-integration\nAgentic-Scope: runtime-integration\n" +
      "Agentic-Lease-Epoch: 1\nAgentic-Mechanism: Agentic Canvas OS protected integration"));
    assert.ok(commands.some(call => call.join(" ") === "npm run check"));
    assert.ok(commands.some(call => call.join(" ") === "git fetch origin main"));
    assert.ok(commands.some(call => call.join(" ") ===
      `git merge -m ${managedCommitSubject} origin/main`));
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
    assert.deepEqual(runtimeCommands[4], {
      command: "git",
      args: ["rev-parse", "HEAD"],
      options: { cwd: canonicalAgenticRoot },
    });
    assert.deepEqual(runtimeCommands[5], {
      command: "git",
      args: ["rev-parse", "--git-common-dir"],
      options: { cwd: canonicalAgenticRoot },
    });
    assert.equal(runtimeCommands[6].command, "node");
    assert.ok(runtimeCommands[6].args.includes(`--worktree=${repo}`));
    assert.deepEqual(result.cleanup, cleanupReceipt({
      repository: canonicalAgenticRoot,
      worktreePath: repo,
    }));
  } finally {
    rmSync(repo, { recursive: true, force: true });
    rmSync(manifestPath, { force: true });
  }
});

test("managed integration commit attribution is bound to the leased branch scope", () => {
  const lease = createLease({ repo: "/tmp/managed-integration" });
  assert.deepEqual(renderManagedCommitMessage({
    branch,
    commitMessage: "fix(runtime-integration): emit lease attribution",
    lease,
  }), {
    subject: "fix(runtime-integration): emit lease attribution",
    body: "Integrate the declared runtime-integration change through its protected managed task lane so downstream policy can attribute the change to its writer lease.",
    trailers: [
      "Agentic-Task: runtime-integration",
      "Agentic-Scope: runtime-integration",
      "Agentic-Lease-Epoch: 1",
      "Agentic-Mechanism: Agentic Canvas OS protected integration",
    ],
  });
  assert.throws(() => renderManagedCommitMessage({
    branch,
    commitMessage: "fix(other-scope): emit lease attribution",
    lease,
  }), /<leased-scope>/u);
  assert.throws(() => renderManagedCommitMessage({
    branch,
    commitMessage: "fix: emit lease attribution",
    lease,
  }), /<leased-scope>/u);
  assert.throws(() => renderManagedCommitMessage({
    branch,
    commitMessage: " fix(runtime-integration): emit lease attribution",
    lease,
  }), /leading or trailing whitespace/u);
  assert.throws(() => renderManagedCommitMessage({
    branch,
    commitMessage: `fix(runtime-integration): ${"x".repeat(61)}`,
    lease,
  }), /summary of at most 60 characters/u);
  assert.equal(renderManagedCommitMessage({
    branch,
    commitMessage: "fix(runtime-integration): bind cloud claim epoch",
    lease: { ...lease, epoch: 197, cloudAuthority: { leaseEpoch: 3 } },
  }).trailers[2], "Agentic-Lease-Epoch: 3");
  assert.throws(() => renderManagedCommitMessage({
    branch,
    commitMessage: "fix(runtime-integration): reject missing claim epoch",
    lease: { ...lease, epoch: 197, cloudAuthority: {} },
  }), /positive claim epoch/u);
});

test("invalid managed integration subjects fail before validation or staging", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-invalid-subject-"));
  const manifestPath = path.join(os.tmpdir(), `agentic-invalid-subject-${process.pid}.json`);
  writeFileSync(manifestPath, JSON.stringify({
    schema: CHANGE_MANIFEST_SCHEMA,
    branch,
    baseSha,
    paths: ["package.json"],
  }));
  const lease = createLease({ repo });
  const commands = [];
  try {
    assert.throws(() => integrateSession({
      invocationPath: repo,
      repo,
      gitText: args => {
        const key = args.join(" ");
        if (key === "branch --show-current") return branch;
        if (key === "worktree list --porcelain -z") return canonicalWorktree(repo);
        if (key === "diff --name-only -z HEAD --") return "package.json\0";
        if (key === "ls-files --others --exclude-standard -z") return "";
        throw new Error(`unexpected git command: ${key}`);
      },
      ghText: () => "",
      leaseStore: {
        read: requested => requested ? lease : { leases: { [branch]: lease } },
        annotate: () => { throw new Error("invalid subject must not annotate integration"); },
      },
      sessionId: "session-a",
      run: (command, args) => commands.push([command, ...args]),
      runText: () => "",
      publishTask: () => {},
      completeTask: () => {},
      commitMessage: "fix: missing leased scope",
      pathsManifest: manifestPath,
      waitSeconds: 1,
      pollSeconds: 0.1,
      log: () => {},
    }), /<leased-scope>/u);
    assert.deepEqual(commands, [["git", "merge-base", "--is-ancestor", fenceSha, "HEAD"]]);
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
        if (command === "git" && args.join(" ") === "rev-parse --git-common-dir") {
          return ".git\n";
        }
        if (command === "git" && args[0] === "rev-parse") return `${mainSha}\n`;
        if (command === "node" && args[0].endsWith("worktree-lifecycle.mjs")) {
          return JSON.stringify(cleanupReceipt({ worktreePath: repo }));
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
    commitMessage: protectedSquashSubject,
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
        if (command === "git" && args.join(" ") === "rev-parse --git-common-dir") {
          return ".git\n";
        }
        if (command === "git" && args[0] === "rev-parse") return `${mainSha}\n`;
        if (command === "node" && args[0].endsWith("worktree-lifecycle.mjs")) {
          return JSON.stringify(cleanupReceipt({ worktreePath: repo }));
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
          pullRequestRead === 1
            ? `pr view ${pullRequestUrl} --json state,baseRefName,url,headRefOid,mergeCommit`
            : `pr view ${pullRequestUrl} --json state,baseRefName,url,headRefOid,mergeCommit,isDraft,isCrossRepository,mergeStateStatus,autoMergeRequest`,
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
        if (command === "git" && args.join(" ") === "rev-parse --git-common-dir") {
          return ".git\n";
        }
        if (command === "git" && args[0] === "rev-parse") return `${mainSha}\n`;
        if (command === "node" && args[0].endsWith("worktree-lifecycle.mjs")) {
          return JSON.stringify(cleanupReceipt({ worktreePath: repo }));
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
      `gh pr merge --auto --squash --subject ${protectedSquashSubject} --match-head-commit ${commitSha} ${pullRequestUrl}`));
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

test("durable integrate fence rejects an invalid reviewed subject before any registry or provider mutation", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-durable-subject-"));
  const gitCommonDir = path.join(repo, "git-common");
  const registryRoot = path.join(gitCommonDir, "agentic-canvas-os");
  const durableLease = createLease({
    repo,
    status: "review_ready",
    autoDelivery: false,
    runtimeRequired: false,
    reviewHeadSha: commitSha,
  });
  mkdirSync(registryRoot, { recursive: true });
  writeFileSync(path.join(registryRoot, "writer-leases.json"), `${JSON.stringify({
    schema: "agentic-writer-lease-registry/v2",
    revision: 1,
    leases: { [branch]: durableLease },
  }, null, 2)}\n`);
  const leaseStore = createWriterLeaseStore({ gitCommonDir });
  const before = leaseStore.readRegistry();
  const mutations = [];
  try {
    assert.throws(() => integrateSession({
      invocationPath: repo,
      repo,
      gitText: args => {
        const key = args.join(" ");
        if (key === "branch --show-current") return branch;
        if (key === `log --first-parent --no-merges -1 --format=%s ${baseSha}..${commitSha}`) {
          return "x".repeat(73);
        }
        throw new Error(`unexpected git command: ${key}`);
      },
      ghText: args => { mutations.push(["ghText", ...args]); return ""; },
      leaseStore,
      sessionId: "session-a",
      run: (command, args) => mutations.push([command, ...args]),
      runText: (command, args) => { mutations.push([command, ...args]); return ""; },
      publishTask: () => mutations.push(["publish"]),
      completeTask: () => mutations.push(["complete"]),
      runtime: "none",
      controllerRoot: repo,
      waitSeconds: 1,
      pollSeconds: 0.1,
      log: () => {},
    }), /Reviewed authored commit subject exceeds 72 characters \(73\)/u);
    assert.deepEqual(mutations, []);
    assert.deepEqual(leaseStore.readRegistry(), before);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("active integration delegates its only entrypoint fence to nested publish", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-fence-"));
  const gitCommonDir = path.join(repo, "git-common");
  const registryRoot = path.join(gitCommonDir, "agentic-canvas-os");
  const activeLease = createLease({ repo, status: "active", integration: {
    schema: "agentic-integration-commit/v1", commitSha, treeSha,
    commitMessage: protectedSquashSubject, manifestDigest: "1".repeat(64),
    stagedDiffDigest: "2".repeat(64), paths: ["scripts/runtime.mjs"],
    recordedAt: "2026-08-10T00:00:00.000Z",
  } });
  mkdirSync(registryRoot, { recursive: true });
  writeFileSync(path.join(registryRoot, "writer-leases.json"), `${JSON.stringify({
    schema: "agentic-writer-lease-registry/v2", revision: 1,
    leases: { [branch]: activeLease },
  }, null, 2)}\n`);
  const leaseStore = createWriterLeaseStore({ gitCommonDir });
  try {
    assert.throws(() => integrateSession({
      invocationPath: repo, repo, leaseStore, sessionId: "session-a", runtime: "none",
      gitText: args => {
        const key = args.join(" ");
        if (key === "branch --show-current") return branch;
        if (key === "worktree list --porcelain -z") return canonicalWorktree(repo);
        if (key === "diff --name-only -z HEAD --" || key === "ls-files --others --exclude-standard -z"
          || key === "status --porcelain") return "";
        if (key === "rev-parse HEAD") return commitSha;
        throw new Error(`unexpected git command: ${key}`);
      },
      run: () => {}, runText: () => "", publishTask: () => {
        assert.equal(leaseStore.readRegistry().reviewedLaneEntrypointFences?.[branch], undefined);
        throw new Error("nested publish owns the fence");
      },
    }), /nested publish owns the fence/u);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("active integration refreshes an exact synchronized stale-base cloud successor before publish", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-successor-"));
  const fixture = createActiveSuccessorFixture({ repo, durableCas: true });
  let publishCalls = 0;
  try {
    assert.throws(() => fixture.integrate({
      publishTask: () => {
        publishCalls += 1;
        assert.equal(fixture.lease.cloudAuthority.claimId, fixture.successor.authority.claimId);
        assert.equal(fixture.lease.baseSha, mainSha);
        assert.equal(fixture.lease.fenceSha, "2".repeat(40));
        throw new Error("stop after refreshed publish");
      },
    }), /stop after refreshed publish/u);
    assert.equal(publishCalls, 1);
    assert.equal(fixture.calls.successor.length, 1);
    assert.equal(fixture.calls.cas.length, 2);
    assert.equal(fixture.calls.successor[0].workItemId, fixture.workItemId);
    assert.equal(fixture.calls.successor[0].leaseEpoch, 2);
    assert.deepEqual(fixture.calls.successor[0].manifest, fixture.sourceAdmission);
    assert.equal(fixture.calls.successor[0].manifest.schema, "agentic-lane-admission-lease/v1");
    assert.equal(
      fixture.calls.successor[0].manifest.admittedReportDigest,
      fixture.sourceAdmission.admittedReportDigest,
    );
    assert.equal(fixture.calls.cas[0].expectedClaimId, fixture.sourceAuthority.claimId);
    assert.equal(fixture.calls.cas[0].values.status, "active");
    assert.equal(fixture.calls.cas[0].values.activePublishSuccessorIntent.status, "prepared");
    assert.equal(fixture.calls.cas[1].values.status, "active");
    assert.equal(fixture.calls.cas[1].values.baseSha, mainSha);
    assert.equal(fixture.calls.cas[1].values.fenceSha, "2".repeat(40));
    assert.equal(fixture.calls.cas[1].values.activePublishSuccessorIntent, null);
    assert.equal(fixture.lease.expiresAt, fixture.successor.authority.expiresAt);
    assert.equal(fixture.lease.admission.schema, "agentic-lane-admission-lease/v1");
    assert.notEqual(fixture.lease.admission.admittedReportDigest, fixture.sourceAdmission.admittedReportDigest);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("active integration can refresh two sequential canonical-base advances", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-two-advances-"));
  const fixture = createActiveSuccessorFixture({ repo, durableCas: true });
  let publishCalls = 0;
  try {
    assert.throws(() => fixture.integrate({
      publishTask: () => {
        publishCalls += 1;
        throw new Error("stop after first advance");
      },
    }), /stop after first advance/u);
    const firstProjectedAdmission = fixture.lease.admission;
    assert.equal(fixture.lease.baseSha, mainSha);
    assert.equal(fixture.lease.activePublishSuccessorIntent, null);

    fixture.advanceCanonicalBase();
    assert.throws(() => fixture.integrate({
      publishTask: () => {
        publishCalls += 1;
        assert.equal(fixture.lease.cloudAuthority.claimId, fixture.successor.authority.claimId);
        throw new Error("stop after second advance");
      },
    }), /stop after second advance/u);
    assert.equal(publishCalls, 2);
    assert.equal(fixture.calls.successor.length, 2);
    assert.equal(fixture.calls.successor[1].leaseEpoch, 3);
    assert.equal(
      fixture.calls.successor[1].manifest.admittedReportDigest,
      firstProjectedAdmission.admittedReportDigest,
    );
    assert.equal(fixture.calls.cas.length, 4);
    assert.equal(fixture.lease.baseSha, "3".repeat(40));
    assert.equal(fixture.lease.fenceSha, "4".repeat(40));
    assert.equal(fixture.lease.cloudAuthority.leaseEpoch, 3);
    assert.equal(fixture.lease.activePublishSuccessorIntent, null);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("active integration retries publish once after exact pushed-head or stale-base convergence", () => {
  const recoverableErrors = [
    `Ownership pull request head ${commitSha} does not match local head ${"2".repeat(40)}.`,
    "Cloud collaboration continue failed: Supplied canonical base does not match the resolved pull request.; " +
      "exact live bind reconciliation failed: Live cloud claim drifted from the recoverable admission subject.",
  ];
  for (const recoverableError of recoverableErrors) {
    const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-retry-"));
    const fixture = createActiveSuccessorFixture({ repo, synchronized: false });
    let publishCalls = 0;
    try {
      assert.throws(() => fixture.integrate({
        publishTask: () => {
          publishCalls += 1;
          if (publishCalls === 1) {
            fixture.convergeRemote();
            throw new Error(recoverableError);
          }
          throw new Error("stop after bounded retry");
        },
      }), /stop after bounded retry/u);
      assert.equal(publishCalls, 2);
      assert.equal(fixture.calls.successor.length, 1);
      assert.equal(fixture.calls.cas.length, 2);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }
});

test("active integration publishes through a provably lagging pull-request base before convergence recovery", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-lagging-pr-base-"));
  const fixture = createActiveSuccessorFixture({
    repo,
    synchronized: false,
    laggingPullRequestBase: true,
  });
  let publishCalls = 0;
  try {
    assert.throws(() => fixture.integrate({
      publishTask: () => {
        publishCalls += 1;
        if (publishCalls === 1) {
          assert.equal(fixture.calls.successor.length, 0);
          assert.equal(fixture.calls.cas.length, 0);
          fixture.convergeRemote();
          throw new Error(
            "Cloud collaboration continue failed: Supplied canonical base does not match the resolved pull request.; " +
            "exact live bind reconciliation failed: Live cloud claim drifted from the recoverable admission subject.",
          );
        }
        throw new Error("stop after lagging-base convergence retry");
      },
    }), /stop after lagging-base convergence retry/u);
    assert.equal(publishCalls, 2);
    assert.equal(fixture.calls.successor.length, 1);
    assert.equal(fixture.calls.cas.length, 2);
    assert.equal(fixture.lease.baseSha, mainSha);
    assert.equal(fixture.lease.fenceSha, "2".repeat(40));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("active integration rejects invalid successor lineage before local annotation or publish", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-invalid-successor-"));
  const fixture = createActiveSuccessorFixture({ repo, tamperPredecessor: true });
  let publishCalls = 0;
  try {
    assert.throws(() => fixture.integrate({
      publishTask: () => { publishCalls += 1; },
    }), /successor lacks exact predecessor, subject, or verification evidence/u);
    assert.equal(fixture.calls.successor.length, 1);
    assert.equal(fixture.calls.cas.length, 1);
    assert.equal(publishCalls, 0);
    assert.equal(fixture.lease.status, "active");
    assert.equal(fixture.lease.activePublishSuccessorIntent.status, "prepared");
    assert.equal(fixture.lease.cloudAuthority.claimId, fixture.sourceAuthority.claimId);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("active integration rejects a canonical-base race before successor mutation or publish", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-base-race-"));
  const fixture = createActiveSuccessorFixture({ repo, ancestorPasses: 1 });
  let publishCalls = 0;
  try {
    assert.throws(() => fixture.integrate({
      publishTask: () => { publishCalls += 1; },
    }), /head does not contain the live canonical base/u);
    assert.equal(fixture.calls.successor.length, 0);
    assert.equal(fixture.calls.cas.length, 0);
    assert.equal(publishCalls, 0);
    assert.strictEqual(fixture.lease, fixture.sourceLease);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("active integration durably resumes every successor response-loss phase", () => {
  for (const phase of ["after-intent", "waiting", "current", "bound", "final-cas"]) {
    const repo = mkdtempSync(path.join(os.tmpdir(), `agentic-integrate-active-${phase}-`));
    const fixture = createActiveSuccessorFixture({ repo, durableCas: true, crashPhase: phase });
    try {
      assert.throws(() => fixture.integrate({
        publishTask: () => { throw new Error("publish preceded successor recovery"); },
      }), new RegExp(`simulated ${phase} response loss`, "u"));
      assert.equal(fixture.lease.status, "active", `${phase} must retain branch ownership`);
      const completedLocally = phase === "final-cas";
      assert.equal(
        fixture.lease.activePublishSuccessorIntent?.status || null,
        completedLocally ? null : "prepared",
      );
      assert.throws(() => fixture.leaseStore.claim({
        sessionId: "competing-session",
        device: "device",
        scope: fixture.sourceLease.scope,
        branch,
        worktreePath: repo,
        baseSha,
      }), /leased to another session/u);

      const runCallsBeforeReplay = fixture.calls.run.length;
      let publishCalls = 0;
      assert.throws(() => fixture.integrate({
        publishTask: () => {
          publishCalls += 1;
          assert.equal(fixture.lease.cloudAuthority.claimId, fixture.successor.authority.claimId);
          assert.equal(fixture.lease.activePublishSuccessorIntent, null);
          throw new Error(`stop after ${phase} replay`);
        },
      }), new RegExp(`stop after ${phase} replay`, "u"));
      assert.equal(publishCalls, 1);
      assert.equal(fixture.lease.status, "active");
      assert.equal(fixture.lease.baseSha, mainSha);
      assert.equal(fixture.lease.fenceSha, "2".repeat(40));
      assert.equal(fixture.lease.expiresAt, fixture.successor.authority.expiresAt);
      if (!completedLocally) {
        assert.equal(
          fixture.calls.run.length,
          runCallsBeforeReplay,
          `${phase} recovery must skip commit and protected-main refresh`,
        );
      }
      if (["after-intent", "waiting"].includes(phase)) {
        assert.equal(fixture.calls.successor.length, 2);
      } else {
        assert.equal(fixture.calls.successor.length, 1);
      }
      assert.equal(fixture.calls.bind.length, phase === "current" ? 1 : 0);
      assert.equal(fixture.calls.verify.length, phase === "bound" ? 1 : 0);
      assert.equal(fixture.calls.cas.length, 2);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }
});

test("active integration retains a prepared intent when the successor expires before local CAS", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-expired-successor-"));
  const fixture = createActiveSuccessorFixture({ repo, durableCas: true, expiredSuccessor: true });
  let publishCalls = 0;
  try {
    assert.throws(() => fixture.integrate({
      publishTask: () => { publishCalls += 1; },
    }), /successor expired before its local projection CAS/u);
    assert.equal(publishCalls, 0);
    assert.equal(fixture.calls.cas.length, 1);
    assert.equal(fixture.lease.status, "active");
    assert.equal(fixture.lease.activePublishSuccessorIntent.status, "prepared");
    assert.equal(fixture.lease.cloudAuthority.claimId, fixture.sourceAuthority.claimId);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("active integration rejects ambiguous or wrong-epoch durable successor derivatives", () => {
  for (const derivativeFault of ["ambiguous", "wrong-epoch"]) {
    const repo = mkdtempSync(path.join(os.tmpdir(), `agentic-integrate-active-${derivativeFault}-`));
    const fixture = createActiveSuccessorFixture({
      repo,
      durableCas: true,
      crashPhase: "waiting",
      derivativeFault,
    });
    let publishCalls = 0;
    try {
      assert.throws(() => fixture.integrate({
        publishTask: () => { publishCalls += 1; },
      }), /simulated waiting response loss/u);
      assert.throws(() => fixture.integrate({
        publishTask: () => { publishCalls += 1; },
      }), /no exact resumable derivative claim/u);
      assert.equal(publishCalls, 0);
      assert.equal(fixture.calls.successor.length, 1);
      assert.equal(fixture.calls.cas.length, 1);
      assert.equal(fixture.lease.status, "active");
      assert.equal(fixture.lease.activePublishSuccessorIntent.status, "prepared");
      assert.equal(fixture.lease.cloudAuthority.claimId, fixture.sourceAuthority.claimId);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }
});

test("active integration fences provider claim epoch fallback to its durable intent", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-epoch-fence-"));
  const fixture = createActiveSuccessorFixture({
    repo,
    durableCas: true,
    providerEpochDemand: 3,
  });
  let publishCalls = 0;
  try {
    assert.throws(() => fixture.integrate({
      publishTask: () => { publishCalls += 1; },
    }), /claim epoch drifted from its durable intent/u);
    assert.equal(publishCalls, 0);
    assert.equal(fixture.calls.invoke.length, 1);
    assert.equal(fixture.calls.invoke[0].action, "claim");
    assert.equal(fixture.calls.invoke[0].request.leaseEpoch, 2);
    assert.equal(fixture.calls.cas.length, 1);
    assert.equal(fixture.lease.status, "active");
    assert.equal(fixture.lease.activePublishSuccessorIntent.status, "prepared");
    assert.equal(fixture.lease.cloudAuthority.claimId, fixture.sourceAuthority.claimId);
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
        if (command === "git" && args.join(" ") === "rev-parse --git-common-dir") {
          return ".git\n";
        }
        if (command === "git" && args[0] === "rev-parse") return `${mainSha}\n`;
        if (command === "node" && args[0].endsWith("worktree-lifecycle.mjs")) {
          return JSON.stringify(cleanupReceipt({ worktreePath: repo }));
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
          pullRequestRead === 0
            ? `pr view ${pullRequestUrl} --json state,baseRefName,url,headRefOid,mergeCommit`
            : `pr view ${pullRequestUrl} --json state,baseRefName,url,headRefOid,mergeCommit,isDraft,isCrossRepository,mergeStateStatus,autoMergeRequest`,
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
        if (command === "git" && args.join(" ") === "rev-parse --git-common-dir") {
          return ".git\n";
        }
        if (command === "git" && args[0] === "rev-parse") return `${mainSha}\n`;
        if (command === "node" && args[0].endsWith("worktree-lifecycle.mjs")) {
          return JSON.stringify(cleanupReceipt({ worktreePath: repo }));
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
      `gh pr merge --auto --squash --subject ${protectedSquashSubject} --match-head-commit ${refreshedHeadSha} ${pullRequestUrl}`));
    assert.ok(commands.some(call => call.join(" ") === "git fetch origin refs/pull/42/head"));
    assert.ok(commands.some(call => call.join(" ") === "git merge --ff-only FETCH_HEAD"));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("review-ready delivery dispatches one exact protected refresh per accepted behind head", () => {
  const events = [];
  const result = runProtectedRefreshScenario({
    events,
    observations: [
      openPullRequest({ mergeStateStatus: "BEHIND" }),
      openPullRequest({ mergeStateStatus: "BEHIND" }),
      mergedPullRequest(),
    ],
  });

  assert.equal(result.status, "integrated");
  const mergeCommand =
    `run:gh pr merge --auto --squash --subject ${protectedSquashSubject} --match-head-commit ${commitSha} ${githubPullRequestUrl}`;
  const dispatchCommand = expectedProtectedRefreshDispatchCommand();
  const dispatchIndexes = events.flatMap(
    (event, index) => event === dispatchCommand ? [index] : [],
  );
  assert.equal(dispatchIndexes.length, 1);
  assert.ok(events.indexOf(mergeCommand) < dispatchIndexes[0]);
  assert.ok(events.indexOf("read:protected-refresh-pull-request") < dispatchIndexes[0]);
  assert.ok(events.indexOf("read:protected-main-ref") < dispatchIndexes[0]);
  assert.equal(events[dispatchIndexes[0] - 1], `verify:${commitSha}`);
  assert.equal(events.some(event => event.includes("update-branch")), false);
});

test("review-ready delivery does not dispatch a protected refresh when the fresh PR is not behind", () => {
  const events = [];
  const result = runProtectedRefreshScenario({
    events,
    observations: [
      openPullRequest({ mergeStateStatus: "CLEAN" }),
      mergedPullRequest(),
    ],
  });

  assert.equal(result.status, "integrated");
  assert.equal(events.some(event => event.includes("workflow run auto-delivery.yml")), false);
});

test("review-ready delivery re-verifies original cloud authority immediately before dispatch", () => {
  const events = [];
  let verificationCount = 0;
  assert.throws(() => runProtectedRefreshScenario({
    events,
    observations: [openPullRequest({ mergeStateStatus: "BEHIND" })],
    onVerify: () => {
      verificationCount += 1;
      if (verificationCount === 3) throw new Error("fresh cloud authority rejected");
    },
  }), /fresh cloud authority rejected/u);

  assert.equal(verificationCount, 3);
  assert.equal(events.some(event => event.includes("workflow run auto-delivery.yml")), false);
  assert.ok(events.some(event => event.startsWith("run:gh pr merge --auto")));
});

test("review-ready delivery fails closed when GitHub rejects the protected refresh dispatch", () => {
  const events = [];
  assert.throws(() => runProtectedRefreshScenario({
    events,
    observations: [openPullRequest({ mergeStateStatus: "BEHIND" })],
    onRun: ({ command, args }) => {
      if (command === "gh" && args[0] === "workflow") {
        throw new Error("GitHub protected refresh dispatch failed");
      }
    },
  }), /GitHub protected refresh dispatch failed/u);
  assert.equal(events.filter(event => event.includes("workflow run auto-delivery.yml")).length, 1);
});

test("review-ready delivery accepts a failed auto-merge command only as an exact armed replay", () => {
  const events = [];
  const result = runProtectedRefreshScenario({
    events,
    failAutoMerge: true,
    autoMergeReplay: openPullRequest({
      url: githubPullRequestUrl,
      autoMergeRequest: { mergeMethod: "SQUASH" },
    }),
    observations: [mergedPullRequest()],
  });

  assert.equal(result.status, "integrated");
  assert.equal(events.filter(event => event.startsWith("run:gh pr merge --auto")).length, 1);
  assert.ok(events.includes("read:replay:OPEN:CLEAN"));
});

test("review-ready delivery rejects an auto-merge head race and unarmed replay", () => {
  assert.throws(() => runProtectedRefreshScenario({
    failAutoMerge: true,
    autoMergeReplay: openPullRequest({
      url: githubPullRequestUrl,
      headRefOid: "2".repeat(40),
      autoMergeRequest: { mergeMethod: "SQUASH" },
    }),
    observations: [],
  }), /no exact armed replay was observed/u);

  for (const autoMergeRequest of [null, { mergeMethod: "MERGE" }]) {
    const events = [];
    assert.throws(() => runProtectedRefreshScenario({
      events,
      failAutoMerge: true,
      autoMergeReplay: openPullRequest({
        url: githubPullRequestUrl,
        autoMergeRequest,
      }),
      observations: [],
    }), /no exact armed replay was observed/u);
    assert.equal(events.some(event => event.includes("workflow run auto-delivery.yml")), false);
  }
});

test("review-ready delivery treats UNKNOWN as a bounded non-mutating poll before verified refresh", () => {
  const events = [];
  const refreshedHeadSha = "2".repeat(40);
  const refreshedMainSha = "3".repeat(40);
  const refreshedTreeSha = "4".repeat(40);
  const result = runProtectedRefreshScenario({
    events,
    protectedRefresh: {
      headSha: refreshedHeadSha,
      mainSha: refreshedMainSha,
      treeSha: refreshedTreeSha,
    },
    observations: [
      openPullRequest({ mergeStateStatus: "BEHIND" }),
      openPullRequest({ mergeStateStatus: "UNKNOWN" }),
      mergedPullRequest({ headRefOid: refreshedHeadSha }),
    ],
  });

  assert.equal(result.status, "integrated");
  assert.equal(events.filter(event => event.includes("workflow run auto-delivery.yml")).length, 1);
  assert.equal(events.some(event => event.includes("update-branch")), false);
  assert.equal(result.protectedMainRefresh.refreshedHeadSha, refreshedHeadSha);
});

test("review-ready delivery requires github.com and rejects unsupported merge states", () => {
  assert.throws(() => runProtectedRefreshScenario({
    pullUrl: pullRequestUrl,
    observations: [openPullRequest({
      mergeStateStatus: "BEHIND",
    })],
  }), /requires the github\.com provider/u);

  assert.throws(() => runProtectedRefreshScenario({
    observations: [openPullRequest({ mergeStateStatus: "ALIEN" })],
  }), /requires a known merge state/u);

  assert.throws(() => runProtectedRefreshScenario({
    pullUrl: `${pullRequestUrl}?unexpected=identity-drift`,
    observations: [openPullRequest({
      url: `${pullRequestUrl}?unexpected=identity-drift`,
      mergeStateStatus: "BEHIND",
    })],
  }), /requires a plain HTTPS pull-request URL/u);
});

test("review-ready delivery refuses forked or unarmed protected refresh dispatches", () => {
  assert.throws(() => runProtectedRefreshScenario({
    observations: [openPullRequest({
      mergeStateStatus: "BEHIND",
      isCrossRepository: true,
    })],
  }), /refuses a fork or unknown head repository/u);

  for (const autoMergeRequest of [null, { mergeMethod: "MERGE" }]) {
    const events = [];
    assert.throws(() => runProtectedRefreshScenario({
      events,
      observations: [openPullRequest({ mergeStateStatus: "BEHIND", autoMergeRequest })],
    }), /requires fresh SQUASH auto-merge authorization/u);
    assert.equal(events.some(event => event.includes("workflow run auto-delivery.yml")), false);
  }
});

test("review-ready delivery rejects missing or drifted full protected-refresh metadata before dispatch", () => {
  const missingBody = protectedRefreshPullRequest();
  delete missingBody.auto_merge.commit_message;
  const missingActorNode = protectedRefreshPullRequest({
    auto_merge: {
      ...protectedRefreshPullRequest().auto_merge,
      enabled_by: {
        ...protectedRefreshPullRequest().auto_merge.enabled_by,
        node_id: null,
      },
    },
  });
  const wrongActor = protectedRefreshPullRequest({
    auto_merge: {
      ...protectedRefreshPullRequest().auto_merge,
      enabled_by: {
        ...protectedRefreshPullRequest().auto_merge.enabled_by,
        login: "another-user",
      },
    },
  });
  const wrongNodeIdentity = protectedRefreshPullRequest({ node_id: "PR_other" });
  const cases = [
    {
      livePullRequest: missingBody,
      error: /exact original auto-merge title and nullable body/u,
    },
    {
      livePullRequest: missingActorNode,
      error: /auto-merge actor node ID must be exact bounded text/u,
    },
    {
      livePullRequest: wrongActor,
      error: /exact original and candidate huijoohwee SQUASH authorizations/u,
    },
    {
      livePullRequest: wrongNodeIdentity,
      error: /exact original and candidate huijoohwee SQUASH authorizations/u,
    },
  ];

  for (const fixture of cases) {
    const events = [];
    assert.throws(() => runProtectedRefreshScenario({
      events,
      observations: [openPullRequest({ mergeStateStatus: "BEHIND" })],
      ...fixture,
    }), fixture.error);
    assert.equal(events.some(event => event.includes("workflow run auto-delivery.yml")), false);
  }
});

test("review-ready delivery rejects live head or protected-main drift before dispatch", () => {
  const driftedHead = protectedRefreshPullRequest({
    head: {
      ...protectedRefreshPullRequest().head,
      sha: "2".repeat(40),
    },
  });
  const cases = [
    {
      livePullRequest: driftedHead,
      error: /metadata drifted from the accepted head or canonical base/u,
    },
    {
      livePullRequest: protectedRefreshPullRequest({
        base: {
          ...protectedRefreshPullRequest().base,
          sha: "3".repeat(40),
        },
      }),
      error: /metadata drifted from the accepted head or canonical base/u,
    },
    {
      liveMainRef: protectedRefreshMainRef({
        object: { type: "commit", sha: null },
      }),
      error: /no exact live protected main SHA/u,
    },
    {
      liveMainRef: protectedRefreshMainRef({ ref: "refs/heads/not-main" }),
      error: /no exact live protected main SHA/u,
    },
  ];

  for (const fixture of cases) {
    const events = [];
    assert.throws(() => runProtectedRefreshScenario({
      events,
      observations: [openPullRequest({ mergeStateStatus: "BEHIND" })],
      ...fixture,
    }), fixture.error);
    assert.equal(events.some(event => event.includes("workflow run auto-delivery.yml")), false);
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
        if (command === "git" && args.join(" ") === "rev-parse --git-common-dir") {
          return ".git\n";
        }
        if (command === "git" && args[0] === "rev-parse") return `${mainSha}\n`;
        if (command === "node" && args[0].endsWith("worktree-lifecycle.mjs")) {
          return JSON.stringify(cleanupReceipt({ worktreePath: repo }));
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

function runAuthorizedAncillaryAutoDelivery({ postRuntimeMainSha = mainSha } = {}) {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-ancillary-auto-"));
  const canonicalAncillaryRoot = path.join(repo, "canonical", "huijoohwee.github.io");
  const canonicalAgenticRoot = path.join(repo, "canonical", "agentic-canvas-os");
  const canonicalKnowgrphRoot = path.join(repo, "canonical", "knowgrph");
  mkdirSync(canonicalAncillaryRoot, { recursive: true });
  mkdirSync(canonicalAgenticRoot, { recursive: true });
  mkdirSync(canonicalKnowgrphRoot, { recursive: true });
  writeFileSync(
    path.join(canonicalAncillaryRoot, "package.json"),
    JSON.stringify({ name: "huijoohwee.github.io" }),
  );
  writeFileSync(path.join(canonicalAgenticRoot, "package.json"), JSON.stringify({ name: "agentic-canvas-os" }));
  writeFileSync(path.join(canonicalKnowgrphRoot, "package.json"), JSON.stringify({ name: "knowgrph" }));
  const agenticCanvasOsSha = "2".repeat(40);
  let lease = createLease({
    repo,
    status: "review_ready",
    autoDelivery: true,
    runtimeRequired: true,
    reviewHeadSha: commitSha,
  });
  let runtimeProven = false;
  let ancillaryHeadReads = 0;
  const commands = [];
  try {
    const result = integrateSession({
      invocationPath: repo,
      repo,
      gitText: args => {
        const key = args.join(" ");
        if (key === "branch --show-current") return branch;
        if (key === "worktree list --porcelain -z") {
          return canonicalWorktree(repo, "huijoohwee.github.io");
        }
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
      runText: (command, args, options = {}) => {
        commands.push({ command, args, options });
        if (command === "git" && args.join(" ") === "rev-parse --git-common-dir") {
          return ".git\n";
        }
        if (command === "git" && args.join(" ") === "rev-parse HEAD") {
          if (options.cwd === canonicalAncillaryRoot) {
            ancillaryHeadReads += 1;
            return `${ancillaryHeadReads === 1 ? mainSha : postRuntimeMainSha}\n`;
          }
          if (options.cwd === canonicalAgenticRoot) return `${agenticCanvasOsSha}\n`;
          if (options.cwd === canonicalKnowgrphRoot) return `${knowgrphSha}\n`;
        }
        if (command === "git" && args.join(" ") === "remote get-url origin") {
          return "https://github.com/huijoohwee/huijoohwee.github.io.git\n";
        }
        if (command === "node" && args[0].endsWith("worktree-lifecycle.mjs")) {
          return JSON.stringify(cleanupReceipt({
            repository: canonicalAncillaryRoot,
            worktreePath: repo,
          }));
        }
        if (command === "node") return "";
        if (command === "npm" && options.cwd === canonicalAgenticRoot &&
            args.join(" ") === `--prefix ${canonicalAgenticRoot} run turn:end -- --repository=${canonicalKnowgrphRoot} --json`) {
          runtimeProven = true;
          return JSON.stringify({
            schema: "agentic-local-runtime-readiness/v1",
            ready: true,
            status: "runtime-ready",
            source: { repository: "huijoohwee/knowgrph", revision: knowgrphSha },
            agenticCanvasOs: { repository: "huijoohwee/agentic-canvas-os", revision: agenticCanvasOsSha },
          });
        }
        throw new Error(`unexpected command: ${command} ${args.join(" ")}`);
      },
      publishTask: () => {},
      completeTask: () => {
        lease = { ...lease, status: "completing", completion: { mergeCommitSha: mergeSha, mainSha } };
        return lease.completion;
      },
      controllerRoot: canonicalAgenticRoot,
      runtimeRepository: canonicalKnowgrphRoot,
      waitSeconds: 1,
      pollSeconds: 0.1,
      log: () => {},
    });

    assert.equal(result.status, "runtime_ready");
    assert.equal(result.canonical.repository, "huijoohwee.github.io");
    assert.equal(result.canonical.mainSha, mainSha);
    assert.equal(result.runtime.readiness.agenticCanvasOs.revision, agenticCanvasOsSha);
    assert.equal(result.runtime.readiness.source.revision, knowgrphSha);
    const cleanup = commands.find(({ command, args }) =>
      command === "node" && args[0].endsWith("worktree-lifecycle.mjs"));
    assert.deepEqual(cleanup, {
      command: "node",
      args: [
        path.join(canonicalAgenticRoot, "scripts", "worktree-lifecycle.mjs"),
        "cleanup",
        `--repository=${canonicalAncillaryRoot}`,
        `--worktree=${repo}`,
      ],
      options: { cwd: canonicalAgenticRoot },
    });
    return result;
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

test("authorized ancillary auto-delivery binds canonical source and exact runtime roots", () => {
  runAuthorizedAncillaryAutoDelivery();
});

test("authorized ancillary auto-delivery rejects canonical source drift during runtime proof", () => {
  assert.throws(
    () => runAuthorizedAncillaryAutoDelivery({ postRuntimeMainSha: "3".repeat(40) }),
    /Canonical runtime readiness did not match the integrated main SHA/u,
  );
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

function runProtectedRefreshScenario({
  pullUrl = githubPullRequestUrl,
  observations,
  events = [],
  onVerify = null,
  onRun = null,
  failAutoMerge = false,
  autoMergeReplay = null,
  protectedRefresh = null,
  livePullRequest = protectedRefreshPullRequest(),
  liveMainRef = protectedRefreshMainRef(),
}) {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-protected-refresh-"));
  const canonicalAgenticRoot = path.join(repo, "canonical", "agentic-canvas-os");
  const canonicalKnowgrphRoot = path.join(repo, "canonical", "knowgrph");
  mkdirSync(canonicalAgenticRoot, { recursive: true });
  mkdirSync(canonicalKnowgrphRoot, { recursive: true });
  writeFileSync(
    path.join(canonicalAgenticRoot, "package.json"),
    JSON.stringify({ name: "agentic-canvas-os" }),
  );
  writeFileSync(
    path.join(canonicalKnowgrphRoot, "package.json"),
    JSON.stringify({ name: "knowgrph" }),
  );
  let lease = createLease({
    repo,
    status: "review_ready",
    autoDelivery: false,
    runtimeRequired: false,
    reviewHeadSha: commitSha,
    pullRequestUrl: pullUrl,
  });
  let initialPullRequestRead = false;
  let autoMergeReplayPending = false;
  let observationIndex = 0;
  let head = commitSha;
  let clock = 0;
  try {
    return integrateSession({
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
        if (protectedRefresh) {
          if (key === "rev-parse FETCH_HEAD") return protectedRefresh.headSha;
          if (key === `rev-list --parents -n 1 ${protectedRefresh.headSha}`) {
            return `${protectedRefresh.headSha} ${commitSha} ${protectedRefresh.mainSha}`;
          }
          if (key === `merge-base --is-ancestor ${protectedRefresh.mainSha} origin/main`) return "";
          if (key ===
            `merge-tree --write-tree --no-messages ${commitSha} ${protectedRefresh.mainSha}`) {
            return protectedRefresh.treeSha;
          }
          if (key === `rev-parse ${protectedRefresh.headSha}^{tree}`) {
            return protectedRefresh.treeSha;
          }
          if (key === "rev-parse HEAD") return head;
          if (key === "status --porcelain") return "";
        }
        throw new Error(`unexpected git command: ${key}`);
      },
      ghText: args => {
        const key = args.join(" ");
        if (key === "api --method GET repos/example/repo/pulls/42") {
          events.push("read:protected-refresh-pull-request");
          return JSON.stringify(livePullRequest);
        }
        if (key === "api --method GET repos/example/repo/git/ref/heads/main") {
          events.push("read:protected-main-ref");
          return JSON.stringify(liveMainRef);
        }
        const expectedFields = !initialPullRequestRead
          ? "state,baseRefName,url,headRefOid,mergeCommit"
          : "state,baseRefName,url,headRefOid,mergeCommit,isDraft,isCrossRepository,mergeStateStatus,autoMergeRequest";
        assert.equal(
          key,
          `pr view ${pullUrl} --json ${expectedFields}`,
        );
        let phase;
        let pullRequest;
        if (!initialPullRequestRead) {
          initialPullRequestRead = true;
          phase = "initial";
          pullRequest = openPullRequest({ url: pullUrl, mergeStateStatus: "CLEAN" });
        } else if (autoMergeReplayPending) {
          autoMergeReplayPending = false;
          phase = "replay";
          pullRequest = autoMergeReplay;
        } else {
          phase = "wait";
          pullRequest = observations[observationIndex++];
        }
        if (!pullRequest) throw new Error("protected refresh fixture exhausted PR observations");
        const boundPullRequest = pullRequest.url === pullRequestUrl
          ? { ...pullRequest, url: pullUrl }
          : pullRequest;
        events.push(
          `read:${phase}:${boundPullRequest.state}:${boundPullRequest.mergeStateStatus || "merged"}`,
        );
        return JSON.stringify(boundPullRequest);
      },
      leaseStore: {
        read: requested => requested ? lease : { leases: { [branch]: lease } },
      },
      sessionId: "session-a",
      buildDeliveryEvidence: () => deliveryEvidence,
      authorizeCloudDelivery: ({ authority, headSha }) => ({
        authority: deliveryAuthorizedAuthority(authority, headSha),
      }),
      verifyCloudAuthority: ({ headSha }) => {
        events.push(`verify:${headSha}`);
        onVerify?.({ headSha });
        return { ok: true };
      },
      run: (command, args) => {
        events.push(`run:${[command, ...args].join(" ")}`);
        onRun?.({ command, args });
        if (command === "gh" && args[0] === "pr" && failAutoMerge) {
          autoMergeReplayPending = true;
          throw new Error("auto-merge command reported already enabled");
        }
        if (command === "git" && args.join(" ") === "merge --ff-only FETCH_HEAD") {
          head = protectedRefresh.headSha;
        }
      },
      runText: (command, args) => {
        if (command === "git" && args.join(" ") === "rev-parse --git-common-dir") {
          return ".git\n";
        }
        if (command === "git" && args[0] === "rev-parse") return `${mainSha}\n`;
        if (command === "node" && args[0].endsWith("worktree-lifecycle.mjs")) {
          return JSON.stringify(cleanupReceipt({ worktreePath: repo }));
        }
        return "";
      },
      publishTask: () => {
        throw new Error("review-ready delivery should not republish authored work");
      },
      completeTask: () => {
        lease = {
          ...lease,
          status: "completed",
          completion: { mergeCommitSha: mergeSha, mainSha },
        };
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
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
}

function openPullRequest(overrides = {}) {
  return {
    url: pullRequestUrl,
    state: "OPEN",
    baseRefName: "main",
    headRefOid: commitSha,
    mergeCommit: null,
    isDraft: false,
    isCrossRepository: false,
    mergeStateStatus: "CLEAN",
    autoMergeRequest: { mergeMethod: "SQUASH" },
    ...overrides,
  };
}

function mergedPullRequest(overrides = {}) {
  return {
    url: pullRequestUrl,
    state: "MERGED",
    baseRefName: "main",
    headRefOid: commitSha,
    mergeCommit: { oid: mergeSha },
    ...overrides,
  };
}

function protectedRefreshPullRequest(overrides = {}) {
  return {
    number: 42,
    html_url: githubPullRequestUrl,
    state: "open",
    merged: false,
    merged_at: null,
    draft: false,
    node_id: pullRequestNodeId,
    title: protectedSquashSubject,
    base: {
      ref: "main",
      sha: baseSha,
      repo: { full_name: "example/repo" },
    },
    head: {
      ref: branch,
      sha: commitSha,
      repo: { full_name: "example/repo" },
    },
    auto_merge: {
      merge_method: "squash",
      enabled_by: {
        id: autoMergeActorDatabaseId,
        node_id: autoMergeActorNodeId,
        login: autoMergeActorLogin,
        type: autoMergeActorType,
      },
      commit_title: protectedSquashSubject,
      commit_message: null,
    },
    mergeable_state: "behind",
    merge_commit_sha: null,
    ...overrides,
  };
}

function protectedRefreshMainRef(overrides = {}) {
  return {
    ref: "refs/heads/main",
    object: { type: "commit", sha: targetMainSha },
    ...overrides,
  };
}

function expectedProtectedRefreshDispatchCommand({ observedHeadSha = commitSha } = {}) {
  const candidateAutoMergeMessage = JSON.stringify([
    "Protected head refresh authorization",
    "",
    "Agentic-Pull-Request: 42",
    `Agentic-Delivered-Head: ${commitSha}`,
    `Agentic-Target-Main: ${targetMainSha}`,
  ].join("\n"));
  const projection = {
    operation: "protected-head-refresh",
    pull_request_number: "42",
    branch,
    delivered_head_sha: commitSha,
    observed_head_sha: observedHeadSha,
    target_main_sha: targetMainSha,
    canonical_base_sha: baseSha,
    claim_id: claimId,
    claim_digest: claimDigest,
    ledger_revision: ledgerRevision,
    review_request_id: reviewRequestId,
    pull_request_node_id: pullRequestNodeId,
    pull_request_title: protectedSquashSubject,
    auto_merge_method: "squash",
    auto_merge_enabled_by_database_id: autoMergeActorDatabaseId,
    auto_merge_enabled_by_node_id: autoMergeActorNodeId,
    auto_merge_enabled_by_login: autoMergeActorLogin,
    auto_merge_enabled_by_type: autoMergeActorType,
    auto_merge_commit_title: protectedSquashSubject,
    auto_merge_commit_message: "null",
    candidate_auto_merge_commit_title: protectedSquashSubject,
    candidate_auto_merge_commit_message: candidateAutoMergeMessage,
    integration_receipt_digest: "7".repeat(64),
    transition_counter: transitionCounter,
  };
  projection.operation_id = createHash("sha256").update(JSON.stringify({
    schema: "agentic-protected-head-refresh-operation/v1",
    repository: "example/repo",
    ...projection,
  })).digest("hex");
  return [
    "run:gh", "workflow", "run", "auto-delivery.yml",
    "--repo", "example/repo", "--ref", "main",
    ...Object.entries(projection).flatMap(([name, value]) => ["-f", `${name}=${value}`]),
  ].join(" ");
}

function createLease({ repo, ...overrides }) {
  const lease = {
    schema: "agentic-writer-lease/v2",
    status: "active",
    epoch: 1,
    sessionId: "session-a",
    device: "device-a",
    scope: "runtime-integration",
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
      claimId,
      claimDigest,
      ledgerRevision,
      transitionCounter,
    };
  }
  return lease;
}

function createActiveSuccessorFixture({
  repo,
  synchronized = true,
  tamperPredecessor = false,
  durableCas = false,
  ancestorPasses = Number.POSITIVE_INFINITY,
  crashPhase = null,
  expiredSuccessor = false,
  derivativeFault = null,
  providerEpochDemand = null,
  laggingPullRequestBase = false,
}) {
  const successorHeadSha = "2".repeat(40);
  const successorClaimId = "c".repeat(64);
  const successorClaimDigest = "d".repeat(64);
  const successorLedgerRevision = "e".repeat(40);
  const successorLedgerDigest = "f".repeat(64);
  const sourceClaimLedgerRevision = "a".repeat(64);
  const sourceLedgerDigest = "b".repeat(64);
  const successorClaimLedgerRevision = "1".repeat(64);
  const sourceOperationReceiptDigest = "2".repeat(64);
  const successorOperationReceiptDigest = "3".repeat(64);
  const workItemId = "work-item:28780f7acb64b0c6";
  const expiresAt = "2099-08-11T12:12:56.000Z";
  const successorExpiresAt = expiredSuccessor ? "2026-08-11T03:59:59.000Z" : expiresAt;
  const manifest = normalizeDeclaredWriteScopeManifest({
    schema: "agentic-declared-write-scope/v1",
    semanticScope: "runtime-integration",
    paths: ["scripts/runtime.mjs"],
  }, { expectedScope: "runtime-integration" });
  const sourceAdmission = Object.freeze({
    schema: "agentic-lane-admission-lease/v1",
    status: "admitted",
    semanticScope: manifest.semanticScope,
    declaredWriteSet: manifest.declaredWriteSet,
    writeSetDigest: manifest.writeSetDigest,
    manifestDigest: manifest.manifestDigest,
    planReceiptDigest: "4".repeat(64),
    admissionReceiptDigest: "5".repeat(64),
    existingLaneStateDigest: "6".repeat(64),
    admittedReportDigest: "7".repeat(64),
    preservationReceiptDigest: "8".repeat(64),
  });
  const sourceAuthority = Object.freeze({
    schema: "agentic-lane-cloud-authority/v1",
    provider: "github",
    ledgerRepository: "example/ledger",
    targetRepository: "example/repo",
    claimId,
    claimDigest,
    ledgerRevision,
    ledgerDigest: sourceLedgerDigest,
    claimLedgerRevision: sourceClaimLedgerRevision,
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    operationReceiptDigest: sourceOperationReceiptDigest,
    mutationAuthorityEligible: true,
    canonicalBaseSha: baseSha,
    laneRevision: commitSha,
    cloudDeclaredWriteScope: manifest.declaredWriteSet,
    writeSetDigest: manifest.writeSetDigest,
    deviceId: "device-a",
    sessionId: "session-a",
    reviewRequestId,
    leaseEpoch: 1,
    transitionCounter: 2,
    state: "active",
    expiresAt,
    integrationReceiptDigest: null,
    integration: null,
    manifestDigest: manifest.manifestDigest,
  });
  const sourceLease = createLease({
    repo,
    baseSha,
    fenceSha,
    heartbeatAt: "2026-08-11T03:55:00.000Z",
    expiresAt,
    admission: sourceAdmission,
    cloudAuthority: sourceAuthority,
    integration: {
      schema: "agentic-integration-commit/v1",
      commitSha,
      treeSha,
      commitMessage: protectedSquashSubject,
      manifestDigest: "9".repeat(64),
      stagedDiffDigest: "a".repeat(64),
      paths: ["scripts/runtime.mjs"],
      recordedAt: "2026-08-10T00:00:00.000Z",
    },
  });
  const claimCore = {
    entrySchema: sourceAuthority.entrySchema,
    claimIdentitySchema: sourceAuthority.claimIdentitySchema,
    actorId: "actor:device-a",
    repositoryId: "repository:example/repo",
    workItemId,
    declaredWriteScope: manifest.declaredWriteSet,
    writeSetDigest: manifest.writeSetDigest,
    reviewRequestId,
    expiresAt,
    integrationReceiptDigest: null,
    integration: null,
  };
  const predecessor = Object.freeze({
    ...claimCore,
    claimId,
    state: "current",
    canonicalBaseRevision: baseSha,
    laneRevision: commitSha,
    leaseEpoch: 1,
    transitionCounter: 2,
    heartbeatCounter: 0,
    fenceRevision: claimDigest,
    transitionDigest: sourceClaimLedgerRevision,
    operationReceiptDigest: sourceOperationReceiptDigest,
  });
  const successorAuthority = Object.freeze({
    ...sourceAuthority,
    claimId: successorClaimId,
    claimDigest: successorClaimDigest,
    ledgerRevision: successorLedgerRevision,
    ledgerDigest: successorLedgerDigest,
    claimLedgerRevision: successorClaimLedgerRevision,
    operationReceiptDigest: successorOperationReceiptDigest,
    canonicalBaseSha: mainSha,
    laneRevision: successorHeadSha,
    leaseEpoch: 2,
    transitionCounter: 2,
    expiresAt: successorExpiresAt,
  });
  const waitingSuccessor = Object.freeze({
    ...claimCore,
    claimId: successorClaimId,
    predecessorClaimId: claimId,
    state: "waiting-successor",
    canonicalBaseRevision: mainSha,
    laneRevision: mainSha,
    leaseEpoch: 2,
    transitionCounter: 1,
    heartbeatCounter: 0,
    reviewRequestId: null,
    expiresAt: successorExpiresAt,
    fenceRevision: "6".repeat(64),
    transitionDigest: "7".repeat(64),
    operationReceiptDigest: "8".repeat(64),
  });
  const currentBaseSuccessor = Object.freeze({
    ...waitingSuccessor,
    state: "current",
    transitionCounter: 2,
    fenceRevision: "9".repeat(64),
    transitionDigest: "a".repeat(64),
    operationReceiptDigest: "b".repeat(64),
  });
  const liveSuccessor = Object.freeze({
    ...claimCore,
    claimId: successorClaimId,
    predecessorClaimId: tamperPredecessor ? "0".repeat(64) : claimId,
    state: "current",
    canonicalBaseRevision: mainSha,
    laneRevision: successorHeadSha,
    leaseEpoch: 2,
    transitionCounter: 2,
    heartbeatCounter: 0,
    expiresAt: successorExpiresAt,
    fenceRevision: successorClaimDigest,
    transitionDigest: successorClaimLedgerRevision,
    operationReceiptDigest: successorOperationReceiptDigest,
  });
  const verifiedClaim = Object.freeze({ ...liveSuccessor, state: "active" });
  const inventoryCore = Object.freeze({
    schema: "agentic-cloud-claim-inventory/v1",
    observedLedgerHeadRevision: successorLedgerRevision,
    ledgerDigest: successorLedgerDigest,
    evaluationTime: "2026-08-11T04:00:00.000Z",
    claims: [verifiedClaim],
  });
  const inventory = Object.freeze({ ...inventoryCore, inventoryDigest: digestValue(inventoryCore) });
  const successor = Object.freeze({
    authority: successorAuthority,
    verification: Object.freeze({
      schema: "agentic-lane-cloud-verification/v1",
      status: "ready",
      claimId: successorClaimId,
      claimDigest: successorClaimDigest,
      ledgerRevision: successorLedgerRevision,
      ledgerDigest: successorLedgerDigest,
      canonicalBaseSha: mainSha,
      laneRevision: successorHeadSha,
      writeSetDigest: manifest.writeSetDigest,
      reviewRequestId,
      remoteClaimInventoryDigest: inventory.inventoryDigest,
      inventory,
      receiptDigest: "b".repeat(64),
      verifiedAt: "2026-08-11T04:00:00.000Z",
    }),
  });
  const secondBaseSha = "3".repeat(40);
  const secondHeadSha = "4".repeat(40);
  const secondClaimId = "5".repeat(64);
  const secondClaimDigest = "6".repeat(64);
  const secondLedgerRevision = "7".repeat(40);
  const secondLedgerDigest = "8".repeat(64);
  const secondClaimLedgerRevision = "9".repeat(64);
  const secondOperationReceiptDigest = "a".repeat(64);
  const secondSuccessorAuthority = Object.freeze({
    ...successorAuthority,
    claimId: secondClaimId,
    claimDigest: secondClaimDigest,
    ledgerRevision: secondLedgerRevision,
    ledgerDigest: secondLedgerDigest,
    claimLedgerRevision: secondClaimLedgerRevision,
    operationReceiptDigest: secondOperationReceiptDigest,
    canonicalBaseSha: secondBaseSha,
    laneRevision: secondHeadSha,
    leaseEpoch: 3,
  });
  const secondLiveSuccessor = Object.freeze({
    ...claimCore,
    claimId: secondClaimId,
    predecessorClaimId: successorClaimId,
    state: "current",
    canonicalBaseRevision: secondBaseSha,
    laneRevision: secondHeadSha,
    leaseEpoch: 3,
    transitionCounter: 2,
    heartbeatCounter: 0,
    fenceRevision: secondClaimDigest,
    transitionDigest: secondClaimLedgerRevision,
    operationReceiptDigest: secondOperationReceiptDigest,
  });
  const secondVerifiedClaim = Object.freeze({ ...secondLiveSuccessor, state: "active" });
  const secondInventoryCore = Object.freeze({
    schema: "agentic-cloud-claim-inventory/v1",
    observedLedgerHeadRevision: secondLedgerRevision,
    ledgerDigest: secondLedgerDigest,
    evaluationTime: "2026-08-11T04:00:00.000Z",
    claims: [secondVerifiedClaim],
  });
  const secondInventory = Object.freeze({
    ...secondInventoryCore,
    inventoryDigest: digestValue(secondInventoryCore),
  });
  const secondSuccessor = Object.freeze({
    authority: secondSuccessorAuthority,
    verification: Object.freeze({
      schema: "agentic-lane-cloud-verification/v1",
      status: "ready",
      claimId: secondClaimId,
      claimDigest: secondClaimDigest,
      ledgerRevision: secondLedgerRevision,
      ledgerDigest: secondLedgerDigest,
      canonicalBaseSha: secondBaseSha,
      laneRevision: secondHeadSha,
      writeSetDigest: manifest.writeSetDigest,
      reviewRequestId,
      remoteClaimInventoryDigest: secondInventory.inventoryDigest,
      inventory: secondInventory,
      receiptDigest: "c".repeat(64),
      verifiedAt: "2026-08-11T04:00:00.000Z",
    }),
  });
  const cloudStatus = claims => Object.freeze({
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "status",
    status: "ready",
    ledgerRevision: claims.includes(predecessor) ? ledgerRevision : "4".repeat(40),
    ledgerDigest: claims.includes(predecessor) ? sourceLedgerDigest : "5".repeat(64),
    claims,
  });
  const calls = { successor: [], bind: [], verify: [], cas: [], run: [], invoke: [] };
  let leaseStore = null;
  if (durableCas) {
    const gitCommonDir = path.join(repo, "git-common");
    const registryRoot = path.join(gitCommonDir, "agentic-canvas-os");
    mkdirSync(registryRoot, { recursive: true });
    writeFileSync(path.join(registryRoot, "writer-leases.json"), `${JSON.stringify({
      schema: "agentic-writer-lease-registry/v2",
      revision: 1,
      leases: { [branch]: sourceLease },
    }, null, 2)}\n`);
    leaseStore = createWriterLeaseStore({ gitCommonDir });
  }
  let lease = leaseStore?.read(branch) || sourceLease;
  let headSha = commitSha;
  let activeRound = 1;
  let canonicalHeadSha = mainSha;
  let refreshHeadSha = successorHeadSha;
  let pullRequestBaseSha = laggingPullRequestBase ? baseSha : canonicalHeadSha;
  let pullRequestHeadSha = synchronized ? successorHeadSha : commitSha;
  let remoteHeadSha = pullRequestHeadSha;
  let ancestorReads = 0;
  let cloudPhase = "predecessor";
  let crashInjected = false;
  const fixture = {
    calls,
    sourceAdmission,
    sourceAuthority,
    sourceLease,
    get successor() { return activeRound === 1 ? successor : secondSuccessor; },
    workItemId,
    leaseStore,
    get lease() { return lease; },
    convergeRemote() {
      pullRequestBaseSha = canonicalHeadSha;
      pullRequestHeadSha = refreshHeadSha;
      remoteHeadSha = refreshHeadSha;
    },
    advanceCanonicalBase() {
      activeRound = 2;
      canonicalHeadSha = secondBaseSha;
      refreshHeadSha = secondHeadSha;
      pullRequestBaseSha = secondBaseSha;
      pullRequestHeadSha = secondHeadSha;
      remoteHeadSha = secondHeadSha;
      cloudPhase = "predecessor";
      ancestorReads = 0;
    },
    integrate({ publishTask }) {
      return integrateSession({
        invocationPath: repo,
        repo,
        sessionId: "session-a",
        runtime: "none",
        waitSeconds: 1,
        pollSeconds: 0.1,
        now: () => new Date("2026-08-11T04:00:00.000Z"),
        sleep: () => {},
        leaseStore: leaseStore || {
          read: requested => requested ? lease : { leases: { [branch]: lease } },
        },
        gitText: args => {
          const key = args.join(" ");
          if (key === "branch --show-current") return branch;
          if (key === "worktree list --porcelain -z") return canonicalWorktree(repo);
          if (key === "diff --name-only -z HEAD --" ||
              key === "ls-files --others --exclude-standard -z" || key === "status --porcelain") return "";
          if (key === "rev-parse HEAD") return headSha;
          if (key === `diff --name-only -z ${canonicalHeadSha}..${refreshHeadSha} --`) {
            return "scripts/runtime.mjs\0";
          }
          if (key === `merge-base --is-ancestor ${canonicalHeadSha} ${refreshHeadSha}`) {
            if (ancestorReads++ >= ancestorPasses) throw new Error("not an ancestor");
            return "";
          }
          if (key === `merge-base --is-ancestor ${baseSha} ${canonicalHeadSha}`) return "";
          if (key === `ls-remote --heads origin refs/heads/main refs/heads/${branch}`) {
            return `${canonicalHeadSha}\trefs/heads/main\n${remoteHeadSha}\trefs/heads/${branch}\n`;
          }
          throw new Error(`unexpected git command: ${key}`);
        },
        ghText: args => {
          assert.equal(
            args.join(" "),
            `pr view ${pullRequestUrl} --json ` +
              "id,url,state,isDraft,baseRefName,baseRefOid,headRefName,headRefOid,headRepository",
          );
          return JSON.stringify({
            id: pullRequestNodeId,
            url: pullRequestUrl,
            state: "OPEN",
            isDraft: true,
            baseRefName: "main",
            baseRefOid: pullRequestBaseSha,
            headRefName: branch,
            headRefOid: pullRequestHeadSha,
            headRepository: { nameWithOwner: sourceAuthority.targetRepository },
          });
        },
        run: (command, args) => {
          const key = [command, ...args].join(" ");
          calls.run.push(key);
          if (key === `git merge -m ${protectedSquashSubject} origin/main`) headSha = refreshHeadSha;
        },
        runText: () => "",
        publishTask,
        completeTask: () => { throw new Error("successor fixture must stop during publish"); },
        ...(providerEpochDemand ? {} : { refreshActiveCloudSuccessor: input => {
          calls.successor.push(input);
          if (!crashInjected && crashPhase && crashPhase !== "final-cas") {
            crashInjected = true;
            cloudPhase = {
              "after-intent": "predecessor",
              waiting: "waiting",
              current: "current-base",
              bound: "bound",
              "final-cas": "bound",
            }[crashPhase];
            throw new Error(`simulated ${crashPhase} response loss`);
          }
          cloudPhase = "bound";
          return activeRound === 1 ? successor : secondSuccessor;
        } }),
        bindActiveCloudSuccessor: input => {
          calls.bind.push(input);
          cloudPhase = "bound";
          return activeRound === 1 ? successor : secondSuccessor;
        },
        verifyActiveCloudSuccessor: input => {
          calls.verify.push(input);
          return activeRound === 1 ? successor : secondSuccessor;
        },
        inspectCloudStatus: () => ({
          predecessor: cloudStatus([activeRound === 1 ? predecessor : liveSuccessor]),
          waiting: cloudStatus(derivativeFault === "ambiguous"
            ? [waitingSuccessor, { ...waitingSuccessor, claimId: "0".repeat(64) }]
            : [{
              ...waitingSuccessor,
              leaseEpoch: derivativeFault === "wrong-epoch" ? 3 : waitingSuccessor.leaseEpoch,
            }]),
          "current-base": cloudStatus([currentBaseSuccessor]),
          bound: cloudStatus([activeRound === 1 ? liveSuccessor : secondLiveSuccessor]),
        })[cloudPhase],
        invokeCloudSuccessor: input => {
          calls.invoke.push(input);
          if (providerEpochDemand && input?.action === "claim") {
            throw new Error(`leaseEpoch must be ${providerEpochDemand}`);
          }
          throw new Error("fake successor must own cloud invocation");
        },
        verifyCloudSuccessor: () => { throw new Error("fake successor must own cloud verification"); },
        casActiveLeaseProjection: input => {
          calls.cas.push(input);
          assert.equal(digestValue(lease), input.expectedLeaseDigest);
          assert.equal(lease.cloudAuthority.claimId, input.expectedClaimId);
          if (leaseStore) {
            const projected = casWriterLeaseProjection(input);
            lease = projected.lease;
            if (!crashInjected && crashPhase === "final-cas" &&
                input.values.activePublishSuccessorIntent === null) {
              crashInjected = true;
              throw new Error("simulated final-cas response loss");
            }
            return projected;
          }
          lease = Object.freeze({ ...lease, ...input.values });
          if (!crashInjected && crashPhase === "final-cas" &&
              input.values.activePublishSuccessorIntent === null) {
            crashInjected = true;
            throw new Error("simulated final-cas response loss");
          }
          return Object.freeze({ lease, intent: null, registryRevision: null });
        },
        log: () => {},
      });
    },
  };
  return fixture;
}

function deliveryDigests(value) {
  return Object.fromEntries(Object.keys(deliveryEvidence).map(key => [key, value[key]]));
}

function canonicalWorktree(repo, canonicalDirectory = "agentic-canvas-os") {
  return `worktree ${path.join(repo, "canonical", canonicalDirectory)}\0HEAD ${baseSha}\0branch refs/heads/main\0\0` +
    `worktree ${repo}\0HEAD ${fenceSha}\0branch refs/heads/${branch}\0\0`;
}
