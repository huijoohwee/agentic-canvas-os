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
  renderProtectedMainRefreshCommitMessage,
  renderProtectedSquashCommitBody,
  resolveRuntimeRepositories,
  validateIntegrationCleanupReceipt,
} from "../scripts/device-integrate-lib.mjs";
import {
  CLOUD_COLLABORATION_BOUNDS,
  digestValue,
} from "../scripts/cloud-collaboration-primitives.mjs";
import { pseudonymousIdentifier } from "../scripts/github-cloud-collaboration-mapping.mjs";
import { normalizeDeclaredWriteScopeManifest } from "../scripts/scoped-lane-admission-lib.mjs";
import { casWriterLeaseProjection } from "../scripts/writer-lease-registry-cas.mjs";
import {
  createWriterLeaseStore,
  updateWriterLeasePullRequestBody,
} from "../scripts/writer-lease-lib.mjs";
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
const protectedSquashBody = [
  "Integrate the declared runtime-integration change through its protected managed task lane so downstream policy can attribute the change to its writer lease.",
  "",
  "Agentic-Task: runtime-integration",
  "Agentic-Scope: runtime-integration",
  "Agentic-Lease-Epoch: 1",
  "Agentic-Mechanism: Agentic Canvas OS protected integration",
].join("\n");
function refreshMergeMessage(subject, epoch = 1) {
  return [
    subject,
    "",
    "Integrate the declared runtime-integration change through its protected managed task lane so downstream policy can attribute the change to its writer lease.",
    "",
    "Agentic-Task: runtime-integration",
    "Agentic-Scope: runtime-integration",
    `Agentic-Lease-Epoch: ${epoch}`,
    "Agentic-Mechanism: Agentic Canvas OS protected integration",
  ].join("\n");
}
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
    writeFileSync(
      path.join(isolatedCanonicalRoot, "package.json"),
      JSON.stringify({ name: "gamexr" }),
    );
    assert.deepEqual(resolveRuntimeRepositories({
      canonicalRoot: isolatedCanonicalRoot,
      controllerRoot: agenticCanvasOsRoot,
      runtimeRepository: knowgrphRoot,
      allowAncillary: true,
      readOriginRemote: () => "https://github.com/huijoohwee/GameXR.git",
    }), {
      integratedRepository: "gamexr",
      agenticCanvasOsRoot,
      knowgrphRoot,
    });
    writeFileSync(
      path.join(isolatedCanonicalRoot, "package.json"),
      JSON.stringify({ name: "huijoohwee.github.io" }),
    );
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
      `git merge -m ${refreshMergeMessage(managedCommitSubject)} origin/main`));
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
  assert.equal(renderProtectedSquashCommitBody({ branch, lease }), protectedSquashBody);
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

test("protected-main refresh merge message carries the leased attribution trailers", () => {
  const lease = createLease({ repo: "/tmp/managed-integration" });
  assert.equal(renderProtectedMainRefreshCommitMessage({
    subject: "fix(runtime-integration): emit lease attribution",
    branch,
    lease,
  }), [
    "fix(runtime-integration): emit lease attribution",
    "",
    "Integrate the declared runtime-integration change through its protected managed task lane so downstream policy can attribute the change to its writer lease.",
    "",
    "Agentic-Task: runtime-integration",
    "Agentic-Scope: runtime-integration",
    "Agentic-Lease-Epoch: 1",
    "Agentic-Mechanism: Agentic Canvas OS protected integration",
  ].join("\n"));
  assert.equal(renderProtectedMainRefreshCommitMessage({
    subject: "fix(runtime-integration): bind cloud claim epoch",
    branch,
    lease: { ...lease, epoch: 197, cloudAuthority: { leaseEpoch: 3 } },
  }).split("\n").includes("Agentic-Lease-Epoch: 3"), true);
  assert.throws(() => renderProtectedMainRefreshCommitMessage({
    subject: "fix: subject\nwith body",
    branch,
    lease,
  }), /single line/u);
  assert.throws(() => renderProtectedMainRefreshCommitMessage({
    subject: `fix: ${"x".repeat(80)}`,
    branch,
    lease,
  }), /exceeds 72 characters/u);
  assert.throws(() => renderProtectedMainRefreshCommitMessage({
    subject: "",
    branch,
    lease,
  }), /must not be empty/u);
  assert.throws(() => renderProtectedMainRefreshCommitMessage({
    subject: "fix(runtime-integration): reject foreign lease binding",
    branch,
    lease: { ...lease, scope: "other-scope" },
  }), /exact leased task-branch scope/u);
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
      ghText: () => JSON.stringify(openPullRequest()),
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
      ghText: () => JSON.stringify(pullRequestRead++ === 0
        ? openPullRequest({ headRefOid: firstRefreshedHeadSha })
        : {
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
      verifyCloudAuthority: ({ headSha, protectedMainRefresh }) => {
        verifiedHeads.push(headSha);
        assert.equal(headSha, commitSha);
        if (protectedMainRefresh) {
          assert.equal(protectedMainRefresh.deliveredHeadSha, commitSha);
          assert.equal(protectedMainRefresh.refreshedHeadSha, refreshedHeadSha);
        }
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
      `gh pr merge --auto --squash --subject ${protectedSquashSubject} --body ${protectedSquashBody} --match-head-commit ${commitSha} ${pullRequestUrl}`));
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
    assert.equal(fixture.calls.successor[0].predecessorClaimId, undefined);
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

test("active integration accepts the exact cloud fallback manifest projection", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-fallback-manifest-"));
  const fixture = createActiveSuccessorFixture({
    repo,
    durableCas: true,
    authorityManifestProjection: "fallback",
  });
  let publishCalls = 0;
  try {
    assert.notEqual(
      fixture.sourceAuthority.manifestDigest,
      fixture.sourceAdmission.manifestDigest,
    );
    assert.equal(fixture.sourceAuthority.manifestDigest, digestValue({
      declaredWriteSet: fixture.sourceAdmission.declaredWriteSet,
      writeSetDigest: fixture.sourceAdmission.writeSetDigest,
    }));
    assert.throws(() => fixture.integrate({
      publishTask: () => {
        publishCalls += 1;
        throw new Error("stop after fallback-manifest successor");
      },
    }), /stop after fallback-manifest successor/u);
    assert.equal(publishCalls, 1);
    assert.equal(fixture.calls.successor.length, 1);
    assert.equal(fixture.calls.cas.length, 2);
    assert.equal(
      fixture.calls.successor[0].manifest.manifestDigest,
      fixture.sourceAdmission.manifestDigest,
    );
    assert.equal(
      fixture.lease.cloudAuthority.manifestDigest,
      fixture.sourceAdmission.manifestDigest,
    );
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("active integration rejects an arbitrary authority manifest projection", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-arbitrary-manifest-"));
  const fixture = createActiveSuccessorFixture({
    repo,
    authorityManifestProjection: "arbitrary",
  });
  let publishCalls = 0;
  try {
    assert.throws(() => fixture.integrate({
      publishTask: () => { publishCalls += 1; },
    }), /Active publish predecessor drifted/u);
    assert.equal(publishCalls, 0);
    assert.equal(fixture.calls.successor.length, 0);
    assert.equal(fixture.calls.cas.length, 0);
    assert.strictEqual(fixture.lease, fixture.sourceLease);
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

test("active integration refreshes ordinary authority before validation and publication", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-renewal-"));
  const fixture = createActiveSuccessorFixture({ repo });
  const phases = [];
  try {
    assert.throws(() => fixture.integrate({
      renewActiveAuthority: ({ lease, phase }) => {
        phases.push(phase);
        return lease;
      },
      publishTask: () => { throw new Error("stop after ordinary authority refresh"); },
    }), /stop after ordinary authority refresh/u);
    assert.deepEqual(phases, ["before-validation", "before-publication"]);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("active integration rejects an authority adapter that diverges from its projection", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-renewal-drift-"));
  const fixture = createActiveSuccessorFixture({ repo });
  let publishCalls = 0;
  try {
    assert.throws(() => fixture.integrate({
      renewActiveAuthority: ({ lease }) => ({ ...lease, heartbeatAt: "2099-01-01T00:00:00.000Z" }),
      publishTask: () => { publishCalls += 1; },
    }), /different local projection/u);
    assert.equal(publishCalls, 0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
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

function prepareHistoricalActivePublishIntent(fixture, phase = "after-intent") {
  assert.throws(() => fixture.integrate({
    publishTask: () => { throw new Error("publish preceded prepared intent"); },
  }), new RegExp(`simulated ${phase} response loss`, "u"));
  const intent = structuredClone(fixture.lease.activePublishSuccessorIntent);
  assert.equal(intent.schema, "agentic-active-publish-successor-intent/v1");
  assert.equal(intent.targetCanonicalBaseSha, mainSha);
  assert.equal(intent.targetHeadSha, fixture.rolloverHeadSha);
  fixture.advancePreparedCanonicalBase();
  return intent;
}

function replacePreparedIntentWithLegacyStableDigest(fixture, intent) {
  const {
    activePublishSuccessorIntent: _activePublishSuccessorIntent,
    heartbeatAt: _heartbeatAt,
    expiresAt: _expiresAt,
    status: _status,
    ...stableLease
  } = fixture.lease;
  const { intentDigest: _intentDigest, ...intentCore } = intent;
  const legacyCore = {
    ...intentCore,
    sourceStableLeaseDigest: digestValue({ ...stableLease, status: "active" }),
  };
  const legacyIntent = { ...legacyCore, intentDigest: digestValue(legacyCore) };
  fixture.replacePreparedIntent(legacyIntent);
  return legacyIntent;
}

test("active integration ignores later ledger-head coordinates for a new prepared intent", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-ledger-projection-"));
  const fixture = createActiveSuccessorFixture({
    repo,
    durableCas: true,
    crashPhase: "after-intent",
    preparedBaseRollover: { pullRequestBaseAfterAdvance: "historical" },
  });
  try {
    prepareHistoricalActivePublishIntent(fixture);
    fixture.refreshSourceLedgerProjection();
    fixture.clearPullRequestMarker();
    assert.throws(() => fixture.integrate({
      publishTask: () => { throw new Error("stop after ledger-independent rollover"); },
    }), /stop after ledger-independent rollover/u);
    assert.equal(fixture.lease.baseSha, fixture.rolloverBaseSha);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("active integration resumes a legacy prepared intent from an exact historical marker", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-legacy-ledger-"));
  const fixture = createActiveSuccessorFixture({
    repo,
    durableCas: true,
    crashPhase: "after-intent",
    preparedBaseRollover: { pullRequestBaseAfterAdvance: "historical" },
  });
  try {
    const intent = prepareHistoricalActivePublishIntent(fixture);
    const legacyIntent = replacePreparedIntentWithLegacyStableDigest(fixture, intent);
    fixture.refreshSourceLedgerProjection();
    assert.throws(() => fixture.integrate({
      publishTask: () => { throw new Error("stop after legacy ledger rollover"); },
    }), /stop after legacy ledger rollover/u);
    const rolloverCas = fixture.calls.cas.find(call =>
      call.values.activePublishSuccessorIntent?.schema ===
        "agentic-active-publish-successor-intent/v2");
    assert.equal(rolloverCas.values.activePublishSuccessorIntent
      .supersededIntent.intentDigest, legacyIntent.intentDigest);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("active integration rejects legacy ledger drift without its exact historical marker", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-legacy-marker-"));
  const fixture = createActiveSuccessorFixture({
    repo,
    durableCas: true,
    crashPhase: "after-intent",
    preparedBaseRollover: { pullRequestBaseAfterAdvance: "historical" },
  });
  try {
    const intent = prepareHistoricalActivePublishIntent(fixture);
    replacePreparedIntentWithLegacyStableDigest(fixture, intent);
    fixture.refreshSourceLedgerProjection();
    fixture.clearPullRequestMarker();
    const successorCalls = fixture.calls.successor.length;
    assert.throws(() => fixture.integrate({
      publishTask: () => { throw new Error("publish escaped missing marker"); },
    }), /Active publish successor intent drifted/u);
    assert.equal(fixture.calls.successor.length, successorCalls);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("active integration rolls a source-only prepared intent across a disjoint protected advance", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-rollover-"));
  const fixture = createActiveSuccessorFixture({
    repo,
    durableCas: true,
    crashPhase: "after-intent",
    preparedBaseRollover: { pullRequestBaseAfterAdvance: "historical" },
  });
  try {
    const historicalIntent = prepareHistoricalActivePublishIntent(fixture);
    const runCalls = fixture.calls.run.length;
    assert.throws(() => fixture.integrate({
      publishTask: () => {
        assert.equal(fixture.lease.baseSha, fixture.rolloverBaseSha);
        assert.equal(fixture.lease.fenceSha, fixture.rolloverHeadSha);
        assert.equal(fixture.lease.activePublishSuccessorIntent, null);
        throw new Error("stop after prepared-base rollover");
      },
    }), /stop after prepared-base rollover/u);

    const rolledIntent = fixture.calls.cas[1].values.activePublishSuccessorIntent;
    assert.equal(rolledIntent.schema, "agentic-active-publish-successor-intent/v2");
    assert.deepEqual(rolledIntent.supersededIntent, historicalIntent);
    assert.equal(rolledIntent.rolloverProof.schema,
      "agentic-active-publish-prepared-base-rollover-proof/v2");
    assert.equal(rolledIntent.rolloverProof.sourceLedgerDigest,
      fixture.sourceAuthority.ledgerDigest);
    assert.equal(rolledIntent.rolloverProof.sourceIntentDigest, historicalIntent.intentDigest);
    assert.equal(rolledIntent.rolloverProof.historicalBaseSha, mainSha);
    assert.equal(rolledIntent.rolloverProof.protectedBaseSha, fixture.rolloverBaseSha);
    assert.equal(rolledIntent.rolloverProof.headSha, fixture.rolloverHeadSha);
    assert.deepEqual(rolledIntent.rolloverProof.authoredPaths, ["scripts/runtime.mjs"]);
    assert.deepEqual(rolledIntent.rolloverProof.protectedPaths, ["docs/protected-main.md"]);
    assert.equal(rolledIntent.targetLeaseEpoch, 2);
    assert.equal(fixture.calls.cas.length, 3);
    assert.deepEqual(fixture.calls.run.slice(runCalls), [
      "git fetch origin main",
      `git merge -m ${refreshMergeMessage(protectedSquashSubject, 2)} origin/main`,
    ]);
    const rolloverSuccessorCalls = fixture.calls.successor.filter(call =>
      call.canonicalBaseSha === fixture.rolloverBaseSha);
    assert.equal(rolloverSuccessorCalls.length, 1);
    assert.equal(rolloverSuccessorCalls[0].predecessorClaimId,
      fixture.sourceAuthority.claimId);
    assert.equal(rolloverSuccessorCalls[0].pullRequestNumber, null);
    assert.equal(rolloverSuccessorCalls[0].reviewRequestId, reviewRequestId);
    const rolloverCasIndex = fixture.calls.timeline.findIndex(item =>
      item.kind === "cas" && item.intentSchema === "agentic-active-publish-successor-intent/v2");
    const protectedSuccessorIndex = fixture.calls.timeline.findIndex(item =>
      item.kind === "successor" && item.canonicalBaseSha === fixture.rolloverBaseSha);
    assert.ok(rolloverCasIndex >= 0 && protectedSuccessorIndex > rolloverCasIndex);
    assert.equal(fixture.calls.git.includes(
      `merge-base --is-ancestor ${fixture.rolloverBaseSha} ${fixture.rolloverHeadSha}`,
    ), false);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("active integration rolls an exact dormant-preserved source across a prepared base advance", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-rollover-dormant-"));
  const fixture = createActiveSuccessorFixture({
    repo,
    durableCas: true,
    crashPhase: "after-intent",
    preparedBaseRollover: { dormantPredecessor: true },
  });
  try {
    const historicalIntent = prepareHistoricalActivePublishIntent(fixture);
    assert.equal(fixture.predecessor.state, "dormant-preserved");
    assert.equal(fixture.predecessor.writeAuthority, false);
    assert.equal(fixture.predecessor.scopeReserved, true);

    assert.throws(() => fixture.integrate({
      publishTask: () => { throw new Error("stop after dormant predecessor rollover"); },
    }), /stop after dormant predecessor rollover/u);

    const rolledIntent = fixture.calls.cas[1].values.activePublishSuccessorIntent;
    assert.equal(rolledIntent.schema, "agentic-active-publish-successor-intent/v2");
    assert.deepEqual(rolledIntent.supersededIntent, historicalIntent);
    assert.equal(
      rolledIntent.rolloverProof.sourceClaimProjectionDigest,
      digestValue(fixture.predecessor),
    );
    const rolloverSuccessorCalls = fixture.calls.successor.filter(call =>
      call.canonicalBaseSha === fixture.rolloverBaseSha);
    assert.equal(rolloverSuccessorCalls.length, 1);
    assert.equal(rolloverSuccessorCalls[0].predecessorClaimId,
      fixture.predecessor.claimId);
    assert.equal(fixture.lease.activePublishSuccessorIntent, null);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("active integration durably replays one dormant-predecessor v2 successor", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-rollover-dormant-replay-"));
  const fixture = createActiveSuccessorFixture({
    repo,
    durableCas: true,
    crashPhase: "after-intent",
    preparedBaseRollover: { dormantPredecessor: true, loseCasResponse: true },
  });
  try {
    prepareHistoricalActivePublishIntent(fixture);
    assert.throws(() => fixture.integrate({
      publishTask: () => { throw new Error("publish preceded dormant v2 replay"); },
    }), /simulated rollover-cas response loss/u);
    const durableIntentDigest = fixture.lease.activePublishSuccessorIntent.intentDigest;
    assert.equal(fixture.calls.successor.filter(call =>
      call.canonicalBaseSha === fixture.rolloverBaseSha).length, 0);

    assert.throws(() => fixture.integrate({
      publishTask: () => { throw new Error("stop after dormant v2 replay"); },
    }), /stop after dormant v2 replay/u);
    const rolloverCasCalls = fixture.calls.cas.filter(call =>
      call.values.activePublishSuccessorIntent?.schema ===
        "agentic-active-publish-successor-intent/v2");
    assert.equal(rolloverCasCalls.length, 1);
    assert.equal(rolloverCasCalls[0].values.activePublishSuccessorIntent.intentDigest,
      durableIntentDigest);
    const rolloverSuccessorCalls = fixture.calls.successor.filter(call =>
      call.canonicalBaseSha === fixture.rolloverBaseSha);
    assert.equal(rolloverSuccessorCalls.length, 1);
    assert.equal(rolloverSuccessorCalls[0].predecessorClaimId,
      fixture.predecessor.claimId);
    assert.equal(fixture.lease.activePublishSuccessorIntent, null);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("active integration preserves a current-sealed v2 proof across deterministic dormancy", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-rollover-expiry-replay-"));
  const fixture = createActiveSuccessorFixture({
    repo,
    durableCas: true,
    crashPhase: "after-intent",
    preparedBaseRollover: {
      dormantPredecessorAfterV2Cas: true,
      loseCasResponse: true,
    },
  });
  try {
    prepareHistoricalActivePublishIntent(fixture);
    assert.equal(fixture.predecessor.state, "current");
    assert.throws(() => fixture.integrate({
      publishTask: () => { throw new Error("publish preceded current-to-dormant replay"); },
    }), /simulated rollover-cas response loss/u);

    const intent = fixture.lease.activePublishSuccessorIntent;
    const dormant = fixture.predecessor;
    assert.equal(intent.schema, "agentic-active-publish-successor-intent/v2");
    assert.equal(dormant.state, "dormant-preserved");
    assert.notEqual(digestValue(dormant), intent.rolloverProof.sourceClaimProjectionDigest);
    assert.equal(digestValue({
      ...dormant,
      state: "current",
      writeAuthority: true,
      scopeReserved: true,
    }), intent.rolloverProof.sourceClaimProjectionDigest);

    assert.throws(() => fixture.integrate({
      publishTask: () => { throw new Error("stop after current-to-dormant replay"); },
    }), /stop after current-to-dormant replay/u);
    const rolloverSuccessorCalls = fixture.calls.successor.filter(call =>
      call.canonicalBaseSha === fixture.rolloverBaseSha);
    assert.equal(rolloverSuccessorCalls.length, 1);
    assert.equal(rolloverSuccessorCalls[0].predecessorClaimId,
      fixture.sourceAuthority.claimId);
    assert.equal(fixture.lease.activePublishSuccessorIntent, null);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("active integration rejects nondeterministic dormant drift from a current-sealed v2 proof", () => {
  const cases = [
    ["heartbeat", { heartbeatCounter: 1 }],
    ["extra projection", { expiryProjection: "tampered" }],
  ];
  for (const [label, dormantPredecessorOverrides] of cases) {
    const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-rollover-expiry-tamper-"));
    const fixture = createActiveSuccessorFixture({
      repo,
      durableCas: true,
      crashPhase: "after-intent",
      preparedBaseRollover: {
        dormantPredecessorAfterV2Cas: true,
        dormantPredecessorOverrides,
        loseCasResponse: true,
      },
    });
    try {
      prepareHistoricalActivePublishIntent(fixture);
      assert.throws(() => fixture.integrate({
        publishTask: () => { throw new Error(`publish preceded ${label} dormancy tamper`); },
      }), /simulated rollover-cas response loss/u);
      const durableIntent = structuredClone(fixture.lease.activePublishSuccessorIntent);

      assert.throws(() => fixture.integrate({
        publishTask: () => { throw new Error(`publish escaped ${label} dormancy tamper`); },
      }), /source claim drifted before cloud publication/u, label);
      assert.deepEqual(fixture.lease.activePublishSuccessorIntent, durableIntent, label);
      assert.equal(fixture.calls.successor.filter(call =>
        call.canonicalBaseSha === fixture.rolloverBaseSha).length, 0, label);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }
});

test("ordinary active publication rejects a dormant-preserved predecessor", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-ordinary-dormant-"));
  const fixture = createActiveSuccessorFixture({
    repo,
    durableCas: true,
    sourcePredecessor: {
      state: "dormant-preserved",
      writeAuthority: false,
      scopeReserved: true,
    },
  });
  try {
    let publishCalls = 0;
    assert.throws(() => fixture.integrate({
      publishTask: () => { publishCalls += 1; },
    }), /predecessor drifted from its exact current cloud projection/u);
    assert.equal(fixture.calls.cas.length, 0);
    assert.equal(fixture.calls.successor.length, 0);
    assert.equal(publishCalls, 0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("active integration rejects malformed dormant rollover projections before effects", () => {
  const cases = [
    ["state", { state: "integrated-preserved" }],
    ["write authority", { writeAuthority: true }],
    ["scope reservation", { scopeReserved: false }],
    ["identity", { workItemId: "work-item:tampered" }],
  ];
  for (const [label, dormantPredecessorOverrides] of cases) {
    const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-rollover-dormant-invalid-"));
    const fixture = createActiveSuccessorFixture({
      repo,
      durableCas: true,
      crashPhase: "after-intent",
      preparedBaseRollover: { dormantPredecessor: true, dormantPredecessorOverrides },
    });
    try {
      const historicalIntent = prepareHistoricalActivePublishIntent(fixture);
      let publishCalls = 0;
      assert.throws(() => fixture.integrate({
        publishTask: () => { publishCalls += 1; },
      }), /requires the exact (?:source claim with no derivative|sealed source claim)/u, label);
      assert.deepEqual(fixture.lease.activePublishSuccessorIntent, historicalIntent, label);
      assert.equal(fixture.calls.cas.length, 1, label);
      assert.equal(fixture.calls.successor.filter(call =>
        call.canonicalBaseSha === fixture.rolloverBaseSha).length, 0, label);
      assert.equal(publishCalls, 0, label);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }
});

test("active integration also rolls over when the provider already exposes the protected base", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-rollover-current-pr-base-"));
  const fixture = createActiveSuccessorFixture({
    repo,
    durableCas: true,
    crashPhase: "after-intent",
    preparedBaseRollover: { pullRequestBaseAfterAdvance: "protected" },
  });
  try {
    prepareHistoricalActivePublishIntent(fixture);
    assert.throws(() => fixture.integrate({
      publishTask: () => { throw new Error("stop after protected-base provider snapshot"); },
    }), /stop after protected-base provider snapshot/u);
    assert.equal(fixture.calls.cas[1].values.activePublishSuccessorIntent.schema,
      "agentic-active-publish-successor-intent/v2");
    assert.equal(fixture.calls.successor.filter(call =>
      call.canonicalBaseSha === fixture.rolloverBaseSha).length, 1);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("active integration replays a durable rollover intent while the provider retains the historical base", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-rollover-historical-replay-"));
  const fixture = createActiveSuccessorFixture({
    repo,
    durableCas: true,
    crashPhase: "after-intent",
    preparedBaseRollover: {
      loseCasResponse: true,
      pullRequestBaseAfterAdvance: "historical",
    },
  });
  try {
    prepareHistoricalActivePublishIntent(fixture);
    assert.throws(() => fixture.integrate({
      publishTask: () => { throw new Error("publish preceded historical-base replay"); },
    }), /simulated rollover-cas response loss/u);
    const durableDigest = fixture.lease.activePublishSuccessorIntent.intentDigest;
    assert.throws(() => fixture.integrate({
      publishTask: () => { throw new Error("stop after historical-base replay"); },
    }), /stop after historical-base replay/u);
    assert.equal(fixture.calls.cas.filter(call =>
      call.values.activePublishSuccessorIntent?.schema ===
        "agentic-active-publish-successor-intent/v2").length, 1);
    assert.equal(fixture.calls.cas[1].values.activePublishSuccessorIntent.intentDigest,
      durableDigest);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("active integration accepts a historical-to-protected provider-base transition under one v2 intent", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-rollover-provider-transition-"));
  const fixture = createActiveSuccessorFixture({
    repo,
    durableCas: true,
    crashPhase: "after-intent",
    preparedBaseRollover: {
      pullRequestBaseAfterAdvance: "historical",
      pullRequestBaseAfterV2Cas: "protected",
    },
  });
  try {
    prepareHistoricalActivePublishIntent(fixture);
    assert.throws(() => fixture.integrate({
      publishTask: () => { throw new Error("stop after provider-base transition"); },
    }), /stop after provider-base transition/u);
    const rolledIntent = fixture.calls.cas[1].values.activePublishSuccessorIntent;
    assert.equal(rolledIntent.schema, "agentic-active-publish-successor-intent/v2");
    assert.equal(rolledIntent.rolloverProof.pullRequestBaseSha, undefined);
    assert.equal(fixture.calls.successor.filter(call =>
      call.canonicalBaseSha === fixture.rolloverBaseSha).length, 1);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("active integration finalizes an exact historical successor before ordinary descendant refresh", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-descendant-refresh-"));
  const fixture = createActiveSuccessorFixture({
    repo,
    durableCas: true,
    crashPhase: "after-intent",
    preparedBaseRollover: {
      pullRequestBaseAfterAdvance: "historical",
      loseCloudResponsePhase: "current-base",
    },
  });
  try {
    prepareHistoricalActivePublishIntent(fixture);
    assert.throws(() => fixture.integrate({
      publishTask: () => { throw new Error("publish preceded current successor effect"); },
    }), /simulated rollover-cloud response loss/u);
    assert.equal(fixture.lease.activePublishSuccessorIntent.schema,
      "agentic-active-publish-successor-intent/v2");

    fixture.advancePreparedProtectedDescendant({ pullRequestBase: "historical" });
    let publishCalls = 0;
    assert.throws(() => fixture.integrate({
      publishTask: () => {
        publishCalls += 1;
        assert.equal(fixture.lease.activePublishSuccessorIntent, null);
        assert.equal(fixture.headSha, fixture.descendantHeadSha);
        if (publishCalls === 1) {
          assert.equal(fixture.lease.baseSha, fixture.rolloverBaseSha);
          assert.equal(fixture.lease.fenceSha, fixture.rolloverHeadSha);
          fixture.convergeRemote();
          throw new Error("Cloud collaboration projection targets another canonical base.");
        }
        assert.equal(fixture.lease.baseSha, fixture.descendantBaseSha);
        assert.equal(fixture.lease.fenceSha, fixture.descendantHeadSha);
        throw new Error("stop after descendant successor publication");
      },
    }), /stop after descendant successor publication/u);

    assert.equal(publishCalls, 2);
    const historicalBind = fixture.calls.bind.find(call =>
      call.authority?.canonicalBaseSha === fixture.rolloverBaseSha);
    assert.ok(historicalBind);
    assert.equal(historicalBind.pullRequestNumber, null);
    assert.equal(historicalBind.reviewRequestId, reviewRequestId);
    const descendantClaims = fixture.calls.successor.filter(call =>
      call.canonicalBaseSha === fixture.descendantBaseSha);
    assert.equal(descendantClaims.length, 1);
    assert.equal(descendantClaims[0].pullRequestNumber, 42);
    assert.equal(fixture.lease.cloudAuthority.claimId,
      fixture.descendantSuccessor.authority.claimId);
    assert.equal(fixture.lease.baseSha, fixture.descendantBaseSha);
    assert.equal(fixture.lease.fenceSha, fixture.descendantHeadSha);
    assert.ok(fixture.calls.run.includes("git fetch origin main"));
    assert.ok(fixture.calls.run.includes(
      `git merge -m ${refreshMergeMessage(protectedSquashSubject, 2)} origin/main`,
    ));
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("active integration rejects a non-descendant protected head before historical finalization", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-descendant-reject-"));
  const fixture = createActiveSuccessorFixture({
    repo,
    durableCas: true,
    crashPhase: "after-intent",
    preparedBaseRollover: {
      pullRequestBaseAfterAdvance: "historical",
      loseCloudResponsePhase: "current-base",
      descendantIsAncestor: false,
    },
  });
  try {
    prepareHistoricalActivePublishIntent(fixture);
    assert.throws(() => fixture.integrate({
      publishTask: () => { throw new Error("publish preceded current successor effect"); },
    }), /simulated rollover-cloud response loss/u);
    fixture.advancePreparedProtectedDescendant({ pullRequestBase: "historical" });
    const before = {
      bind: fixture.calls.bind.length,
      cas: fixture.calls.cas.length,
      successor: fixture.calls.successor.length,
    };
    let publishCalls = 0;
    assert.throws(() => fixture.integrate({
      publishTask: () => { publishCalls += 1; },
    }), /live protected head is not a descendant of its sealed base/u);
    assert.equal(fixture.calls.bind.length, before.bind);
    assert.equal(fixture.calls.cas.length, before.cas);
    assert.equal(fixture.calls.successor.length, before.successor);
    assert.equal(publishCalls, 0);
    assert.equal(fixture.lease.activePublishSuccessorIntent.schema,
      "agentic-active-publish-successor-intent/v2");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("active integration rejects a provider base outside the exact historical/protected set", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-rollover-foreign-pr-base-"));
  const fixture = createActiveSuccessorFixture({
    repo,
    durableCas: true,
    crashPhase: "after-intent",
    preparedBaseRollover: { pullRequestBaseAfterAdvance: "intermediate" },
  });
  try {
    const historicalIntent = prepareHistoricalActivePublishIntent(fixture);
    assert.throws(() => fixture.integrate({
      publishTask: () => { throw new Error("publish escaped foreign provider base"); },
    }), /outside the exact historical\/protected set/u);
    assert.deepEqual(fixture.lease.activePublishSuccessorIntent, historicalIntent);
    assert.equal(fixture.calls.cas.length, 1);
    assert.equal(fixture.calls.successor.filter(call =>
      call.canonicalBaseSha === fixture.rolloverBaseSha).length, 0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("active integration replays a durable rollover intent after its CAS response is lost", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-rollover-cas-"));
  const fixture = createActiveSuccessorFixture({
    repo,
    durableCas: true,
    crashPhase: "after-intent",
    preparedBaseRollover: { loseCasResponse: true },
  });
  try {
    prepareHistoricalActivePublishIntent(fixture);
    assert.throws(() => fixture.integrate({
      publishTask: () => { throw new Error("publish preceded rollover replay"); },
    }), /simulated rollover-cas response loss/u);
    const durableDigest = fixture.lease.activePublishSuccessorIntent.intentDigest;
    assert.equal(fixture.lease.activePublishSuccessorIntent.schema,
      "agentic-active-publish-successor-intent/v2");
    assert.equal(fixture.calls.successor.filter(call =>
      call.canonicalBaseSha === fixture.rolloverBaseSha).length, 0);

    assert.throws(() => fixture.integrate({
      publishTask: () => { throw new Error("stop after rollover CAS replay"); },
    }), /stop after rollover CAS replay/u);
    const rolloverCasCalls = fixture.calls.cas.filter(call =>
      call.values.activePublishSuccessorIntent?.schema ===
        "agentic-active-publish-successor-intent/v2");
    assert.equal(rolloverCasCalls.length, 1);
    assert.equal(rolloverCasCalls[0].values.activePublishSuccessorIntent.intentDigest, durableDigest);
    assert.equal(fixture.calls.successor.filter(call =>
      call.canonicalBaseSha === fixture.rolloverBaseSha).length, 1);
    assert.equal(fixture.lease.activePublishSuccessorIntent, null);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("active integration adopts its exact protected-base derivative after response loss", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-rollover-cloud-"));
  const fixture = createActiveSuccessorFixture({
    repo,
    durableCas: true,
    crashPhase: "after-intent",
    preparedBaseRollover: { loseCloudResponse: true },
  });
  try {
    prepareHistoricalActivePublishIntent(fixture);
    assert.throws(() => fixture.integrate({
      publishTask: () => { throw new Error("publish preceded cloud replay"); },
    }), /simulated rollover-cloud response loss/u);
    assert.equal(fixture.lease.activePublishSuccessorIntent.schema,
      "agentic-active-publish-successor-intent/v2");

    assert.throws(() => fixture.integrate({
      publishTask: () => { throw new Error("stop after rollover-cloud replay"); },
    }), /stop after rollover-cloud replay/u);
    const rolloverSuccessorCalls = fixture.calls.successor.filter(call =>
      call.canonicalBaseSha === fixture.rolloverBaseSha);
    assert.equal(rolloverSuccessorCalls.length, 2);
    assert.equal(rolloverSuccessorCalls[1].activePublishClaimReplayOnly, true);
    assert.equal(fixture.calls.verify.length, 1);
    assert.equal(fixture.lease.activePublishSuccessorIntent, null);
    assert.equal(fixture.lease.baseSha, fixture.rolloverBaseSha);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("active integration resumes one exact waiting protected-base derivative beside its source", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-rollover-waiting-"));
  const fixture = createActiveSuccessorFixture({
    repo,
    durableCas: true,
    crashPhase: "after-intent",
    preparedBaseRollover: { loseCloudResponsePhase: "waiting" },
  });
  try {
    prepareHistoricalActivePublishIntent(fixture);
    assert.throws(() => fixture.integrate({
      publishTask: () => { throw new Error("publish preceded waiting rollover replay"); },
    }), /simulated rollover-cloud response loss/u);
    assert.equal(fixture.lease.activePublishSuccessorIntent.schema,
      "agentic-active-publish-successor-intent/v2");
    assert.equal(fixture.rolloverNamedLineage, true);

    assert.throws(() => fixture.integrate({
      publishTask: () => { throw new Error("stop after waiting rollover replay"); },
    }), /stop after waiting rollover replay/u);
    const waitingStatus = fixture.calls.status.find(call =>
      call.cloudPhase === "waiting" && call.rolloverCloudTarget === "protected");
    const waitingDerivative = waitingStatus.claims.find(claim =>
      claim.claimId !== fixture.sourceAuthority.claimId);
    assert.equal(waitingDerivative.state, "waiting-successor");
    assert.equal(waitingDerivative.laneRevision, fixture.rolloverHeadSha);
    assert.equal(waitingDerivative.predecessorClaimId, fixture.sourceAuthority.claimId);
    const rolloverSuccessorCalls = fixture.calls.successor.filter(call =>
      call.canonicalBaseSha === fixture.rolloverBaseSha);
    assert.equal(rolloverSuccessorCalls.length, 2);
    assert.deepEqual(
      rolloverSuccessorCalls.map(call => call.predecessorClaimId),
      [fixture.sourceAuthority.claimId, fixture.sourceAuthority.claimId],
    );
    assert.equal(fixture.calls.bind.length, 0);
    assert.equal(fixture.calls.verify.length, 0);
    assert.equal(fixture.lease.activePublishSuccessorIntent, null);
    assert.equal(fixture.lease.baseSha, fixture.rolloverBaseSha);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("active integration resumes named head-lineage current and bound rollover effects", () => {
  for (const phase of ["current-base", "bound"]) {
    const repo = mkdtempSync(path.join(os.tmpdir(), `agentic-integrate-active-rollover-head-${phase}-`));
    const fixture = createActiveSuccessorFixture({
      repo,
      durableCas: true,
      crashPhase: "after-intent",
      preparedBaseRollover: { loseCloudResponsePhase: phase },
    });
    try {
      prepareHistoricalActivePublishIntent(fixture);
      assert.throws(() => fixture.integrate({
        publishTask: () => { throw new Error(`publish preceded named ${phase} replay`); },
      }), /simulated rollover-cloud response loss/u);
      assert.equal(fixture.rolloverNamedLineage, true, phase);

      assert.throws(() => fixture.integrate({
        publishTask: () => { throw new Error(`stop after named ${phase} replay`); },
      }), new RegExp(`stop after named ${phase} replay`, "u"));
      const phaseStatus = fixture.calls.status.find(call =>
        call.cloudPhase === phase && call.rolloverCloudTarget === "protected");
      const derivative = phaseStatus.claims.find(claim =>
        claim.claimId !== fixture.sourceAuthority.claimId);
      assert.equal(derivative.state, "current", phase);
      assert.equal(derivative.laneRevision, fixture.rolloverHeadSha, phase);
      assert.equal(derivative.predecessorClaimId, fixture.sourceAuthority.claimId, phase);
      assert.equal(fixture.calls.bind.length, phase === "current-base" ? 1 : 0, phase);
      assert.equal(fixture.calls.verify.length, phase === "bound" ? 1 : 0, phase);
      const rolloverSuccessorCalls = fixture.calls.successor.filter(call =>
        call.canonicalBaseSha === fixture.rolloverBaseSha);
      assert.equal(rolloverSuccessorCalls.length, 2, phase);
      assert.deepEqual(
        rolloverSuccessorCalls.map(call => call.predecessorClaimId),
        [fixture.sourceAuthority.claimId, fixture.sourceAuthority.claimId],
        phase,
      );
      assert.equal(rolloverSuccessorCalls[1].activePublishClaimReplayOnly, true, phase);
      const replayClaim = fixture.calls.invoke.filter(call => call.action === "claim").at(-1);
      const sourceRetirement = fixture.calls.invoke.filter(call =>
        call.action === "retire" &&
        call.request.claimId === fixture.sourceAuthority.claimId).at(-1);
      assert.equal(replayClaim.request.expectedLedgerDigest,
        fixture.sourceAuthority.ledgerDigest, phase);
      assert.equal(sourceRetirement.request.expectedLedgerDigest, undefined, phase);
      assert.equal(sourceRetirement.request.expectedFenceRevision,
        fixture.sourceAuthority.claimDigest, phase);
      assert.equal(sourceRetirement.request.expectedTransitionCounter,
        fixture.sourceAuthority.transitionCounter, phase);
      assertExactRolloverSourceRetirement({ fixture, retirement: sourceRetirement, label: phase });
      assert.equal(fixture.lease.activePublishSuccessorIntent, null, phase);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }
});

test("active integration replays legacy base-lineage waiting, current, and bound v2 derivatives", () => {
  for (const phase of ["waiting", "current-base", "bound"]) {
    const repo = mkdtempSync(path.join(os.tmpdir(), `agentic-integrate-active-rollover-base-${phase}-`));
    const fixture = createActiveSuccessorFixture({
      repo,
      durableCas: true,
      crashPhase: "after-intent",
      preparedBaseRollover: {
        legacyProtectedDerivativeAfterV2Cas: phase,
        loseCasResponse: true,
        doublePrefixClaimReplayStale: phase === "bound",
      },
    });
    try {
      prepareHistoricalActivePublishIntent(fixture);
      assert.throws(() => fixture.integrate({
        publishTask: () => { throw new Error(`publish preceded legacy ${phase} replay`); },
      }), /simulated rollover-cas response loss/u);
      assert.equal(fixture.rolloverNamedLineage, false, phase);

      assert.throws(() => fixture.integrate({
        publishTask: () => { throw new Error(`stop after legacy ${phase} replay`); },
      }), new RegExp(`stop after legacy ${phase} replay`, "u"));
      const phaseStatus = fixture.calls.status.find(call =>
        call.cloudPhase === phase && call.rolloverCloudTarget === "protected");
      const derivative = phaseStatus.claims.find(claim =>
        claim.claimId !== fixture.sourceAuthority.claimId);
      assert.equal(derivative.laneRevision,
        phase === "bound" ? fixture.rolloverHeadSha : fixture.rolloverBaseSha, phase);
      assert.equal(derivative.predecessorClaimId, fixture.sourceAuthority.claimId, phase);
      const rolloverSuccessorCalls = fixture.calls.successor.filter(call =>
        call.canonicalBaseSha === fixture.rolloverBaseSha);
      assert.equal(rolloverSuccessorCalls.length, phase === "bound" ? 2 : 1, phase);
      assert.equal(rolloverSuccessorCalls.at(-1).predecessorClaimId, undefined, phase);
      if (phase === "bound") {
        assert.equal(rolloverSuccessorCalls[0].predecessorClaimId,
          fixture.sourceAuthority.claimId, phase);
      }
      assert.equal(fixture.calls.bind.length, phase === "current-base" ? 1 : 0, phase);
      assert.equal(fixture.calls.verify.length, phase === "bound" ? 1 : 0, phase);
      if (phase !== "waiting") {
        const sourceRetirement = fixture.calls.invoke.filter(call =>
          call.action === "retire" &&
          call.request.claimId === fixture.sourceAuthority.claimId).at(-1);
        assert.equal(sourceRetirement.request.expectedFenceRevision,
          fixture.sourceAuthority.claimDigest, phase);
        assert.equal(sourceRetirement.request.expectedTransitionCounter,
          fixture.sourceAuthority.transitionCounter, phase);
        assert.equal(sourceRetirement.request.expectedLedgerDigest, undefined, phase);
        assertExactRolloverSourceRetirement({ fixture, retirement: sourceRetirement, label: phase });
      }
      assert.equal(fixture.lease.activePublishSuccessorIntent, null, phase);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }
});

test("active integration rejects wrong-parent rollover genesis before resumed effects", () => {
  for (const phase of ["current-base", "bound"]) {
    const repo = mkdtempSync(path.join(os.tmpdir(), `agentic-integrate-active-rollover-parent-${phase}-`));
    const fixture = createActiveSuccessorFixture({
      repo,
      durableCas: true,
      crashPhase: "after-intent",
      preparedBaseRollover: {
        loseCloudResponsePhase: phase,
        rolloverClaimReplayWrongParent: true,
        doublePrefixClaimReplayStale: phase === "bound",
      },
    });
    try {
      prepareHistoricalActivePublishIntent(fixture);
      assert.throws(() => fixture.integrate({
        publishTask: () => { throw new Error(`publish preceded wrong-parent ${phase}`); },
      }), /simulated rollover-cloud response loss/u, phase);
      const before = {
        bind: fixture.calls.bind.length,
        verify: fixture.calls.verify.length,
        cas: fixture.calls.cas.length,
        successor: fixture.calls.successor.length,
        invoke: fixture.calls.invoke.length,
      };

      assert.throws(() => fixture.integrate({
        publishTask: () => { throw new Error(`publish escaped wrong-parent ${phase}`); },
      }), /expectedLedgerDigest is stale/u, phase);

      assert.equal(fixture.calls.bind.length, before.bind, phase);
      assert.equal(fixture.calls.verify.length, before.verify, phase);
      assert.equal(fixture.calls.cas.length, before.cas, phase);
      assert.equal(fixture.calls.successor.length - before.successor,
        phase === "bound" ? 2 : 1, phase);
      assert.equal(fixture.calls.invoke.length - before.invoke,
        phase === "bound" ? 2 : 1, phase);
      const replays = fixture.calls.invoke.slice(before.invoke);
      assert.ok(replays.every(call =>
        call.request.expectedLedgerDigest === fixture.sourceAuthority.ledgerDigest), phase);
      assert.equal(replays[0].request.predecessorClaimId,
        fixture.sourceAuthority.claimId, phase);
      if (phase === "bound") {
        assert.equal(replays[1].request.predecessorClaimId, undefined, phase);
      }
      assert.equal(fixture.lease.activePublishSuccessorIntent.schema,
        "agentic-active-publish-successor-intent/v2", phase);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }
});

test("active integration rejects progressed rollover effects retired from a later source fence", () => {
  for (const { label, options, responseLoss } of [
    {
      label: "named-H bound",
      options: { loseCloudResponsePhase: "bound", rolloverSourceRetirementDrift: true },
      responseLoss: /simulated rollover-cloud response loss/u,
    },
    {
      label: "implicit-P bound",
      options: {
        legacyProtectedDerivativeAfterV2Cas: "bound",
        loseCasResponse: true,
        rolloverSourceRetirementDrift: true,
      },
      responseLoss: /simulated rollover-cas response loss/u,
    },
  ]) {
    const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-rollover-retire-parent-"));
    const fixture = createActiveSuccessorFixture({
      repo,
      durableCas: true,
      crashPhase: "after-intent",
      preparedBaseRollover: options,
    });
    try {
      prepareHistoricalActivePublishIntent(fixture);
      assert.throws(() => fixture.integrate({
        publishTask: () => { throw new Error(`publish preceded ${label}`); },
      }), responseLoss, label);
      const before = {
        cas: fixture.calls.cas.length,
        invoke: fixture.calls.invoke.length,
        verify: fixture.calls.verify.length,
      };

      assert.throws(() => fixture.integrate({
        publishTask: () => { throw new Error(`publish escaped ${label}`); },
      }), /expectedFenceRevision is stale/u, label);

      assert.equal(fixture.calls.cas.length, before.cas, label);
      assert.equal(fixture.calls.verify.length, before.verify, label);
      const mutations = fixture.calls.invoke.slice(before.invoke);
      assert.deepEqual(mutations.map(call => call.action),
        label.startsWith("named") ? ["claim", "retire"] : ["claim", "claim", "retire"],
        label);
      const retirement = mutations.at(-1);
      assert.equal(retirement.request.expectedFenceRevision,
        fixture.sourceAuthority.claimDigest, label);
      assert.equal(retirement.request.expectedTransitionCounter,
        fixture.sourceAuthority.transitionCounter, label);
      assert.equal(retirement.request.expectedLedgerDigest, undefined, label);
      assertExactRolloverSourceRetirement({ fixture, retirement, label });
      assert.equal(fixture.lease.activePublishSuccessorIntent.schema,
        "agentic-active-publish-successor-intent/v2", label);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }
});

test("active integration rejects foreign-owner progressed rollover recovery", () => {
  for (const { label, phase, observed, owner } of [
    {
      label: "observed foreign device before bind",
      phase: "current-base",
      observed: true,
      owner: { deviceId: `device:${"0".repeat(64)}` },
    },
    {
      label: "observed foreign session before verify",
      phase: "bound",
      observed: true,
      owner: { sessionId: `session:${"0".repeat(64)}` },
    },
    {
      label: "replayed foreign session before bind",
      phase: "current-base",
      observed: false,
      owner: { sessionId: `session:${"1".repeat(64)}` },
    },
    {
      label: "replayed foreign device before verify",
      phase: "bound",
      observed: false,
      owner: { deviceId: `device:${"1".repeat(64)}` },
    },
  ]) {
    const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-rollover-owner-"));
    const fixture = createActiveSuccessorFixture({
      repo,
      durableCas: true,
      crashPhase: "after-intent",
      preparedBaseRollover: {
        loseCloudResponsePhase: phase,
        ...(observed
          ? { rolloverDerivativeOwnerOverrides: owner }
          : { rolloverClaimReplayOwnerOverrides: owner }),
      },
    });
    try {
      prepareHistoricalActivePublishIntent(fixture);
      assert.throws(() => fixture.integrate({
        publishTask: () => { throw new Error(`publish preceded ${label}`); },
      }), /simulated rollover-cloud response loss/u, label);
      const before = {
        bind: fixture.calls.bind.length,
        verify: fixture.calls.verify.length,
        cas: fixture.calls.cas.length,
        invoke: fixture.calls.invoke.length,
      };

      assert.throws(() => fixture.integrate({
        publishTask: () => { throw new Error(`publish escaped ${label}`); },
      }), observed
        ? /no exact resumable derivative claim/u
        : /exact original waiting projection/u, label);

      assert.equal(fixture.calls.bind.length, before.bind, label);
      assert.equal(fixture.calls.verify.length, before.verify, label);
      assert.equal(fixture.calls.cas.length, before.cas, label);
      assert.equal(fixture.calls.invoke.length - before.invoke, observed ? 0 : 1, label);
      assert.equal(fixture.lease.activePublishSuccessorIntent.schema,
        "agentic-active-publish-successor-intent/v2", label);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }
});

test("active integration accepts an already-normalized source owner during rollover replay", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-rollover-normalized-owner-"));
  const fixture = createActiveSuccessorFixture({
    repo,
    durableCas: true,
    crashPhase: "after-intent",
    normalizedSourceAuthorityOwner: true,
    preparedBaseRollover: { loseCloudResponsePhase: "bound" },
  });
  try {
    prepareHistoricalActivePublishIntent(fixture);
    assert.throws(() => fixture.integrate({
      publishTask: () => { throw new Error("publish preceded normalized-owner replay"); },
    }), /simulated rollover-cloud response loss/u);

    assert.throws(() => fixture.integrate({
      publishTask: () => { throw new Error("stop after normalized-owner replay"); },
    }), /stop after normalized-owner replay/u);
    assert.equal(fixture.calls.verify.length, 1);
    assert.equal(fixture.lease.activePublishSuccessorIntent, null);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("active integration strips cloud mutation overrides from successor child environments", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-cloud-env-"));
  const fixture = createActiveSuccessorFixture({
    repo,
    durableCas: true,
    crashPhase: "after-intent",
    preparedBaseRollover: { loseCloudResponsePhase: "bound" },
  });
  const poison = {
    GH_TOKEN: "credential-retained",
    UNRELATED_ACTIVE_PUBLISH_TEST: "retained",
    AGENTIC_CLOUD_EXPECTED_LEDGER_DIGEST: "0".repeat(64),
    AGENTIC_CLOUD_LEASE_EPOCH: "99",
    AGENTIC_CLOUD_PREDECESSOR_CLAIM_ID: "1".repeat(64),
    AGENTIC_CLOUD_REQUEST_JSON: "poisoned-request",
    AGENTIC_TARGET_REPOSITORY: "evil/example",
    AGENTIC_DEVICE_ID: "evil-device",
    AGENTIC_SESSION_ID: "evil-session",
  };
  try {
    prepareHistoricalActivePublishIntent(fixture);
    assert.throws(() => fixture.integrate({
      publishTask: () => { throw new Error("publish preceded environment replay"); },
    }), /simulated rollover-cloud response loss/u);
    const statusCalls = fixture.calls.status.length;
    const invokeCalls = fixture.calls.invoke.length;
    const verifiedChildren = [];

    assert.throws(() => fixture.integrate({
      environment: poison,
      publishTask: () => { throw new Error("stop after sanitized environment replay"); },
      verifyActiveCloudSuccessor: input => input.invoke({
        action: "verify",
        ledgerRepository: fixture.sourceAuthority.ledgerRepository,
        request: { targetRepository: fixture.sourceAuthority.targetRepository },
        environment: poison,
      }),
      verifyCloudSuccessor: input => {
        verifiedChildren.push(input);
        return fixture.successor;
      },
    }), /stop after sanitized environment replay/u);

    const childEnvironments = [
      ...fixture.calls.status.slice(statusCalls).map(call => call.environment),
      ...fixture.calls.invoke.slice(invokeCalls).map(call => call.environment),
      ...verifiedChildren.map(call => call.environment),
    ];
    assert.ok(childEnvironments.length >= 5);
    for (const environment of childEnvironments) {
      assert.equal(environment.GH_TOKEN, "credential-retained");
      assert.equal(environment.UNRELATED_ACTIVE_PUBLISH_TEST, "retained");
      assert.equal(environment.AGENTIC_TARGET_REPOSITORY, undefined);
      assert.equal(environment.AGENTIC_DEVICE_ID, undefined);
      assert.equal(environment.AGENTIC_SESSION_ID, undefined);
      assert.equal(Object.keys(environment).some(key => key.startsWith("AGENTIC_CLOUD_")), false);
    }
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("active integration rejects a current or bound protected derivative beside its source", () => {
  for (const loseCloudResponsePhase of ["current-base", "bound"]) {
    const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-rollover-coexist-"));
    const fixture = createActiveSuccessorFixture({
      repo,
      durableCas: true,
      crashPhase: "after-intent",
      preparedBaseRollover: {
        loseCloudResponsePhase,
        protectedDerivativeRetainsSource: true,
      },
    });
    try {
      prepareHistoricalActivePublishIntent(fixture);
      assert.throws(() => fixture.integrate({
        publishTask: () => { throw new Error("publish preceded coexistence rejection"); },
      }), /simulated rollover-cloud response loss/u);
      assert.throws(() => fixture.integrate({
        publishTask: () => { throw new Error(`publish escaped ${loseCloudResponsePhase}`); },
      }), /source claim coexists with a non-waiting derivative/u);
      assert.equal(fixture.lease.activePublishSuccessorIntent.schema,
        "agentic-active-publish-successor-intent/v2");
      assert.equal(fixture.calls.successor.filter(call =>
        call.canonicalBaseSha === fixture.rolloverBaseSha).length, 1);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }
});

test("active integration fetches an absent exact protected-base object without updating refs", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-rollover-fetch-"));
  const fixture = createActiveSuccessorFixture({
    repo,
    durableCas: true,
    crashPhase: "after-intent",
    preparedBaseRollover: {
      protectedObjectAvailable: false,
      pullRequestBaseAfterAdvance: "historical",
    },
  });
  try {
    prepareHistoricalActivePublishIntent(fixture);
    const runCalls = fixture.calls.run.length;
    assert.throws(() => fixture.integrate({
      publishTask: () => { throw new Error("stop after exact protected-base fetch"); },
    }), /stop after exact protected-base fetch/u);
    assert.deepEqual(fixture.calls.run.slice(runCalls), [
      `git fetch --no-tags --no-write-fetch-head origin ${fixture.rolloverBaseSha}`,
      "git fetch origin main",
      `git merge -m ${refreshMergeMessage(protectedSquashSubject, 2)} origin/main`,
    ]);
    assert.equal(fixture.lease.baseSha, fixture.rolloverBaseSha);
    assert.equal(fixture.lease.fenceSha, fixture.rolloverHeadSha);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("active integration rejects exact protected-base fetch failure or post-fetch base drift", () => {
  const cases = [
    ["fetch failure", { protectedObjectAvailable: false, fetchProtectedObjectFails: true }],
    ["base drift", { protectedObjectAvailable: false, postFetchBaseDrift: true }],
    ["pull-request base drift", {
      protectedObjectAvailable: false,
      postFetchPullRequestBaseDrift: true,
      pullRequestBaseAfterAdvance: "historical",
    }],
  ];
  for (const [label, preparedBaseRollover] of cases) {
    const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-rollover-fetch-"));
    const fixture = createActiveSuccessorFixture({
      repo, durableCas: true, crashPhase: "after-intent", preparedBaseRollover,
    });
    try {
      const historicalIntent = prepareHistoricalActivePublishIntent(fixture);
      const runCalls = fixture.calls.run.length;
      assert.throws(() => fixture.integrate({
        publishTask: () => { throw new Error(`publish escaped ${label}`); },
      }));
      assert.deepEqual(fixture.calls.run.slice(runCalls), [
        `git fetch --no-tags --no-write-fetch-head origin ${fixture.rolloverBaseSha}`,
      ], label);
      assert.deepEqual(fixture.lease.activePublishSuccessorIntent, historicalIntent, label);
      assert.equal(fixture.calls.cas.length, 1, label);
      assert.equal(fixture.calls.successor.filter(call =>
        call.canonicalBaseSha === fixture.rolloverBaseSha).length, 0, label);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }
});

test("active integration rejects overlapping or inexact prepared-base rollover proofs", () => {
  const cases = [
    ["protected overlap", { protectedPaths: ["scripts/runtime.mjs"] }],
    ["authored path outside admission", { authoredPaths: ["scripts/outside.mjs"] }],
    ["missing merge base", { mergeBases: [] }],
    ["wrong merge base", { mergeBases: [baseSha] }],
    ["ambiguous merge base", { mergeBases: [mainSha, baseSha] }],
  ];
  for (const [label, preparedBaseRollover] of cases) {
    const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-rollover-proof-"));
    const fixture = createActiveSuccessorFixture({
      repo, durableCas: true, crashPhase: "after-intent", preparedBaseRollover,
    });
    try {
      const historicalIntent = prepareHistoricalActivePublishIntent(fixture);
      assert.throws(() => fixture.integrate({
        publishTask: () => { throw new Error(`publish escaped ${label}`); },
      }));
      assert.deepEqual(fixture.lease.activePublishSuccessorIntent, historicalIntent, label);
      assert.equal(fixture.calls.cas.length, 1, label);
      assert.equal(fixture.calls.successor.filter(call =>
        call.canonicalBaseSha === fixture.rolloverBaseSha).length, 0, label);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }
});

test("active integration rejects post-CAS head or pull-request drift before rollover effects", () => {
  for (const postCasDrift of [
    "local-head", "remote-head", "pull-request-head", "pull-request-id",
    "pull-request-base", "protected-base",
  ]) {
    const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-rollover-drift-"));
    const fixture = createActiveSuccessorFixture({
      repo,
      durableCas: true,
      crashPhase: "after-intent",
      preparedBaseRollover: { postCasDrift },
    });
    try {
      prepareHistoricalActivePublishIntent(fixture);
      assert.throws(() => fixture.integrate({
        publishTask: () => { throw new Error(`publish escaped ${postCasDrift}`); },
      }));
      assert.equal(fixture.lease.activePublishSuccessorIntent.schema,
        "agentic-active-publish-successor-intent/v2", postCasDrift);
      assert.equal(fixture.calls.cas.length, 2, postCasDrift);
      assert.equal(fixture.calls.successor.filter(call =>
        call.canonicalBaseSha === fixture.rolloverBaseSha).length, 0, postCasDrift);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }
});

test("active integration rejects every historical-base derivative before rollover CAS", () => {
  for (const phase of ["waiting", "current", "bound"]) {
    const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-rollover-effect-"));
    const fixture = createActiveSuccessorFixture({
      repo,
      durableCas: true,
      crashPhase: phase,
      preparedBaseRollover: { protectedObjectAvailable: false },
    });
    try {
      const historicalIntent = prepareHistoricalActivePublishIntent(fixture, phase);
      assert.throws(() => fixture.integrate({
        publishTask: () => { throw new Error(`publish escaped ${phase}`); },
      }), /historical-base derivative/u);
      assert.deepEqual(fixture.lease.activePublishSuccessorIntent, historicalIntent, phase);
      assert.equal(fixture.calls.cas.length, 1, phase);
      assert.equal(fixture.calls.successor.filter(call =>
        call.canonicalBaseSha === fixture.rolloverBaseSha).length, 0, phase);
      assert.equal(fixture.calls.bind.length, 0, phase);
      assert.equal(fixture.calls.verify.length, 0, phase);
      assert.equal(fixture.calls.run.some(call =>
        call.startsWith("git fetch --no-tags --no-write-fetch-head origin ")), false, phase);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }
});

test("active integration rejects a historical-base derivative raced after rollover CAS", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-rollover-race-"));
  const fixture = createActiveSuccessorFixture({
    repo,
    durableCas: true,
    crashPhase: "after-intent",
    preparedBaseRollover: { postCasCloudPhase: "bound" },
  });
  try {
    prepareHistoricalActivePublishIntent(fixture);
    assert.throws(() => fixture.integrate({
      publishTask: () => { throw new Error("publish escaped raced historical derivative"); },
    }), /historical-base derivative/u);
    assert.equal(fixture.lease.activePublishSuccessorIntent.schema,
      "agentic-active-publish-successor-intent/v2");
    assert.equal(fixture.calls.cas.length, 2);
    assert.equal(fixture.calls.successor.filter(call =>
      call.canonicalBaseSha === fixture.rolloverBaseSha).length, 0);
    assert.equal(fixture.calls.bind.length, 0);
    assert.equal(fixture.calls.verify.length, 0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("active integration rejects a tampered durable rollover proof before cloud effects", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-rollover-tamper-"));
  const fixture = createActiveSuccessorFixture({
    repo,
    durableCas: true,
    crashPhase: "after-intent",
    preparedBaseRollover: { loseCasResponse: true },
  });
  try {
    prepareHistoricalActivePublishIntent(fixture);
    assert.throws(() => fixture.integrate({
      publishTask: () => { throw new Error("publish preceded proof tamper"); },
    }), /simulated rollover-cas response loss/u);
    const intent = structuredClone(fixture.lease.activePublishSuccessorIntent);
    const proof = {
      ...intent.rolloverProof,
      protectedPaths: ["docs/tampered-protected-main.md"],
    };
    proof.protectedPathsDigest = digestValue(proof.protectedPaths);
    const { evidenceDigest: _evidenceDigest, ...proofCore } = proof;
    proof.evidenceDigest = digestValue(proofCore);
    const changedIntent = { ...intent, rolloverProof: proof };
    const { intentDigest: _intentDigest, ...intentCore } = changedIntent;
    changedIntent.intentDigest = digestValue(intentCore);
    fixture.replacePreparedIntent(changedIntent);
    const casCalls = fixture.calls.cas.length;

    assert.throws(() => fixture.integrate({
      publishTask: () => { throw new Error("publish escaped proof tamper"); },
    }), /rollover proof drifted before cloud publication/u);
    assert.equal(fixture.calls.cas.length, casCalls);
    assert.equal(fixture.calls.successor.filter(call =>
      call.canonicalBaseSha === fixture.rolloverBaseSha).length, 0);
    assert.equal(fixture.lease.activePublishSuccessorIntent.intentDigest, changedIntent.intentDigest);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("active integration fails closed on a legacy rollover proof without a ledger parent seal", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-rollover-v1-proof-"));
  const fixture = createActiveSuccessorFixture({
    repo,
    durableCas: true,
    crashPhase: "after-intent",
    preparedBaseRollover: { loseCasResponse: true },
  });
  try {
    prepareHistoricalActivePublishIntent(fixture);
    assert.throws(() => fixture.integrate({
      publishTask: () => { throw new Error("publish preceded legacy proof downgrade"); },
    }), /simulated rollover-cas response loss/u);
    const intent = structuredClone(fixture.lease.activePublishSuccessorIntent);
    const {
      sourceLedgerDigest: _sourceLedgerDigest,
      evidenceDigest: _evidenceDigest,
      ...proofFields
    } = intent.rolloverProof;
    const proofCore = {
      ...proofFields,
      schema: "agentic-active-publish-prepared-base-rollover-proof/v1",
    };
    const legacyProof = { ...proofCore, evidenceDigest: digestValue(proofCore) };
    const changedIntent = { ...intent, rolloverProof: legacyProof };
    const { intentDigest: _intentDigest, ...intentCore } = changedIntent;
    changedIntent.intentDigest = digestValue(intentCore);
    fixture.replacePreparedIntent(changedIntent);
    const casCalls = fixture.calls.cas.length;

    assert.throws(() => fixture.integrate({
      publishTask: () => { throw new Error("publish escaped legacy proof downgrade"); },
    }), /lacks a sealed source ledger digest and requires operator recovery/u);
    assert.equal(fixture.calls.cas.length, casCalls);
    assert.equal(fixture.calls.successor.filter(call =>
      call.canonicalBaseSha === fixture.rolloverBaseSha).length, 0);
  } finally {
    rmSync(repo, { recursive: true, force: true });
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

test("active integration rejects inexact v1 durable successor derivatives", () => {
  for (const derivativeFault of ["ambiguous", "wrong-epoch", "head-unbound"]) {
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

test("active integration fences same-claim rollover drift before a successor effect", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-ledger-fence-"));
  const fixture = createActiveSuccessorFixture({
    repo,
    durableCas: true,
    crashPhase: "after-intent",
    providerLedgerDrift: true,
    preparedBaseRollover: {
      pullRequestBaseAfterAdvance: "historical",
      ledgerDigestAfterV2Cas: "4".repeat(64),
    },
  });
  try {
    prepareHistoricalActivePublishIntent(fixture);
    assert.equal(fixture.calls.invoke.length, 1);
    assert.equal(fixture.calls.invoke[0].request.expectedLedgerDigest, undefined);

    assert.throws(() => fixture.integrate({
      publishTask: () => { throw new Error("publish escaped stale rollover ledger fence"); },
    }), /expectedLedgerDigest is stale/u);

    const rolloverClaim = fixture.calls.invoke.at(-1);
    assert.equal(rolloverClaim.action, "claim");
    assert.equal(rolloverClaim.request.predecessorClaimId,
      fixture.sourceAuthority.claimId);
    assert.equal(rolloverClaim.request.expectedLedgerDigest,
      fixture.sourceAuthority.ledgerDigest);
    assert.equal(fixture.calls.status.at(-1).ledgerDigest, "4".repeat(64));
    assert.equal(
      fixture.lease.activePublishSuccessorIntent.rolloverProof.sourceLedgerDigest,
      fixture.sourceAuthority.ledgerDigest,
    );
    assert.equal(fixture.calls.successor.length, 0);
    assert.equal(fixture.lease.activePublishSuccessorIntent.schema,
      "agentic-active-publish-successor-intent/v2");
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
});

test("active integration fences same-ID source drift before nested retirement", () => {
  for (const [label, retirementFence] of [
    ["claim digest", { expectedFenceRevision: "0".repeat(64) }],
    ["transition counter", { expectedTransitionCounter: 3 }],
  ]) {
    const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-retire-fence-"));
    const fixture = createActiveSuccessorFixture({
      repo,
      durableCas: true,
      crashPhase: "after-intent",
      preparedBaseRollover: { pullRequestBaseAfterAdvance: "historical" },
    });
    try {
      prepareHistoricalActivePublishIntent(fixture);
      const invoked = [];
      assert.throws(() => fixture.integrate({
        publishTask: () => { throw new Error(`publish escaped ${label} retirement drift`); },
        refreshActiveCloudSuccessor: input => {
          input.invoke({
            action: "claim",
            request: {
              canonicalBaseSha: fixture.rolloverBaseSha,
              headSha: fixture.rolloverHeadSha,
              leaseEpoch: 2,
            },
          });
          return input.invoke({
            action: "retire",
            request: {
              claimId: fixture.sourceAuthority.claimId,
              expectedFenceRevision: fixture.sourceAuthority.claimDigest,
              expectedTransitionCounter: fixture.sourceAuthority.transitionCounter,
              ...retirementFence,
            },
          });
        },
        invokeCloudSuccessor: input => {
          invoked.push(input);
          if (input.action === "claim") {
            return cloudMutationResult({
              action: "claim",
              claim: { ...fixture.rolloverWaitingClaim, laneRevision: fixture.rolloverHeadSha },
              replayed: false,
            });
          }
          return cloudMutationResult({
            action: "retire", claim: fixture.rolloverRetiredSource, replayed: false,
          });
        },
      }), /source retirement fence drifted from its durable intent/u, label);
      assert.deepEqual(invoked.map(input => input.action), ["claim", "retire"], label);
      assert.equal(invoked[0].request.expectedLedgerDigest,
        fixture.sourceAuthority.ledgerDigest, label);
      assert.equal(invoked[1].request.expectedLedgerDigest, undefined, label);
      assert.equal(fixture.calls.cas.length, 2, label);
      assert.equal(fixture.lease.activePublishSuccessorIntent.schema,
        "agentic-active-publish-successor-intent/v2", label);
    } finally {
      rmSync(repo, { recursive: true, force: true });
    }
  }
});

test("active integration permits the sealed retirement fence after time-only dormancy", () => {
  const repo = mkdtempSync(path.join(os.tmpdir(), "agentic-integrate-active-retire-dormant-"));
  const fixture = createActiveSuccessorFixture({
    repo,
    durableCas: true,
    crashPhase: "after-intent",
    preparedBaseRollover: { dormantPredecessor: true },
  });
  try {
    prepareHistoricalActivePublishIntent(fixture);
    const invoked = [];
    assert.throws(() => fixture.integrate({
      publishTask: () => { throw new Error("publish escaped dormant retirement fence"); },
      refreshActiveCloudSuccessor: input => {
        input.invoke({
          action: "claim",
          request: {
            canonicalBaseSha: fixture.rolloverBaseSha,
            headSha: fixture.rolloverHeadSha,
            leaseEpoch: 2,
          },
        });
        input.invoke({
          action: "retire",
          request: {
            claimId: fixture.sourceAuthority.claimId,
            expectedFenceRevision: fixture.sourceAuthority.claimDigest,
            expectedTransitionCounter: fixture.sourceAuthority.transitionCounter,
          },
        });
        throw new Error("stop after dormant retirement fence");
      },
      invokeCloudSuccessor: input => {
        invoked.push(input);
        if (input.action === "claim") {
          return cloudMutationResult({
            action: "claim",
            claim: { ...fixture.rolloverWaitingClaim, laneRevision: fixture.rolloverHeadSha },
            replayed: false,
          });
        }
        return cloudMutationResult({
          action: "retire", claim: fixture.rolloverRetiredSource,
          replayed: invoked.filter(call => call.action === "retire").length > 1,
        });
      },
    }), /stop after dormant retirement fence/u);
    assert.deepEqual(invoked.map(input => input.action), ["claim", "retire", "retire"]);
    assert.equal(fixture.predecessor.state, "dormant-preserved");
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
  const verifiedProtectedRefreshes = [];
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
      verifyCloudAuthority: ({ headSha, protectedMainRefresh }) => {
        verifiedHeads.push(headSha);
        assert.equal(headSha, commitSha);
        if (protectedMainRefresh) {
          verifiedProtectedRefreshes.push(protectedMainRefresh);
          assert.equal(protectedMainRefresh.deliveredHeadSha, commitSha);
          assert.equal(protectedMainRefresh.refreshedHeadSha, refreshedHeadSha);
        }
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
    assert.equal(verifiedProtectedRefreshes.length, 3);
    assert.deepEqual(result.protectedMainRefresh, {
      schema: "agentic-protected-main-refresh/v1",
      deliveredHeadSha: commitSha,
      refreshedHeadSha,
      mainParentSha: refreshedMainSha,
    });
    assert.ok(commands.some(call => call.join(" ") ===
      `gh pr merge --auto --squash --subject ${protectedSquashSubject} --body ${protectedSquashBody} --match-head-commit ${refreshedHeadSha} ${pullRequestUrl}`));
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

test("review-ready delivery uses the reviewed head after base recovery", () => {
  const events = [];
  const result = runProtectedRefreshScenario({
    events,
    staleDeliveryHeadSha: fenceSha,
    observations: [mergedPullRequest()],
  });

  assert.equal(result.status, "integrated");
  assert.equal(events.includes(`verify:${fenceSha}`), false);
  assert.ok(events.includes(`verify:${commitSha}`));
});

test("review-ready merged replay verifies terminal cloud authority before completion", () => {
  const events = [];
  const result = runProtectedRefreshScenario({
    events,
    initialPullRequest: mergedPullRequest(),
    terminalMergedReplay: true,
    onVerify: input => {
      assert.deepEqual(input.deliveryEvidence, deliveryEvidence);
    },
    observations: [],
  });

  assert.equal(result.status, "integrated");
  assert.ok(events.includes(`verify:${commitSha}`));
  assert.ok(events.includes("authorize:delivery"));
  assert.equal(events.some(event => event.startsWith("run:gh pr merge")), false);
});

test("expired delivery merged replay verifies historical retirement after live recovery fails", () => {
  const events = [];
  const mergedRecovery = openPullRequest({
    state: "MERGED",
    baseRefOid: baseSha,
    mergeCommit: { oid: mergeSha },
    mergeStateStatus: "UNKNOWN",
    autoMergeRequest: null,
  });
  const result = runProtectedRefreshScenario({
    leaseStatus: "delivery",
    events,
    terminalMergedReplay: true,
    deliveryRecovery: {
      mutateObservedClaim: claim => ({ ...claim, transitionCounter: 4 }),
      pullRequests: [mergedRecovery, mergedRecovery],
    },
    livePullRequest: protectedRefreshPullRequest({
      state: "closed",
      merged: true,
      merged_at: "2026-08-11T09:00:00.000Z",
      auto_merge: null,
      mergeable_state: "unknown",
      merge_commit_sha: mergeSha,
    }),
    observations: [],
  });

  assert.equal(result.status, "integrated");
  assert.equal(events.filter(event => event === "recover:status").length, 1);
  assert.equal(events.includes("recover:continue"), false);
  assert.ok(events.includes(`verify:${commitSha}`));
  assert.equal(events.some(event => event.includes("workflow run auto-delivery.yml")), false);
});

test("delivery replay dispatches one protected refresh and continues from the exact refreshed head", () => {
  const events = [];
  const refreshedHeadSha = "2".repeat(40);
  const refreshedMainSha = "3".repeat(40);
  const refreshedTreeSha = "4".repeat(40);
  const result = runProtectedRefreshScenario({
    leaseStatus: "delivery",
    events,
    protectedRefresh: {
      headSha: refreshedHeadSha,
      mainSha: refreshedMainSha,
      treeSha: refreshedTreeSha,
    },
    observations: [
      openPullRequest({ mergeStateStatus: "BEHIND" }),
      openPullRequest({ mergeStateStatus: "BEHIND" }),
      mergedPullRequest({ headRefOid: refreshedHeadSha }),
    ],
  });

  assert.equal(result.status, "integrated");
  assert.equal(
    events.filter(event => event === expectedProtectedRefreshDispatchCommand()).length,
    1,
  );
  assert.equal(events.some(event => event.startsWith("run:gh pr merge --auto")), false);
  assert.equal(result.protectedMainRefresh.refreshedHeadSha, refreshedHeadSha);
  assert.ok(events.includes("run:git fetch origin refs/pull/42/head"));
  assert.ok(events.includes("run:git merge --ff-only FETCH_HEAD"));
});

test("expired delivery replay recovers the same integrated claim before one protected refresh dispatch", () => {
  const events = [];
  const refreshedHeadSha = "2".repeat(40);
  let recoveryInput;
  const result = runProtectedRefreshScenario({
    leaseStatus: "delivery",
    events,
    deliveryRecovery: {
      onRecover: input => { recoveryInput = input; },
    },
    protectedRefresh: {
      headSha: refreshedHeadSha,
      mainSha: "3".repeat(40),
      treeSha: "4".repeat(40),
    },
    observations: [
      openPullRequest({ mergeStateStatus: "BEHIND" }),
      openPullRequest({ mergeStateStatus: "BEHIND" }),
      mergedPullRequest({ headRefOid: refreshedHeadSha }),
    ],
  });

  assert.equal(result.status, "integrated");
  assert.equal(recoveryInput.integratedClaim.state, "dormant-preserved");
  assert.equal(recoveryInput.queuedSuccessor, null);
  assert.equal(recoveryInput.branch, branch);
  assert.equal(recoveryInput.headSha, commitSha);
  assert.equal(recoveryInput.deviceId, "device-a");
  assert.equal(recoveryInput.sessionId, "session-a");
  assert.deepEqual(events.slice(0, 11), [
    "read:recovery:1",
    "read:protected-refresh-pull-request",
    "read:protected-main-ref",
    "run:git fetch origin main",
    "verify:recovery-fetched-main",
    "verify:recovery-main-ancestor",
    "recover:status",
    "recover:continue",
    "read:recovery:2",
    "read:protected-refresh-pull-request",
    "read:protected-main-ref",
  ]);
  assert.equal(events.filter(event => event.includes("workflow run auto-delivery.yml")).length, 1);
  assert.equal(events.some(event => event.startsWith("run:gh pr merge --auto")), false);
  assert.equal(result.protectedMainRefresh.refreshedHeadSha, refreshedHeadSha);
});

test("expired delivery replay adopts an already-live same-claim recovery after response loss", () => {
  const events = [];
  let recoveryInput;
  const result = runProtectedRefreshScenario({
    leaseStatus: "delivery",
    events,
    deliveryRecovery: {
      alreadyLive: true,
      onRecover: input => { recoveryInput = input; },
    },
    observations: [mergedPullRequest()],
  });

  assert.equal(result.status, "integrated");
  assert.equal(recoveryInput.integratedClaim.state, "integrated-preserved");
  assert.equal(recoveryInput.authority.transitionCounter, 5);
  assert.equal(recoveryInput.integratedClaim.transitionCounter, 6);
  assert.notEqual(
    recoveryInput.integratedClaim.operationReceiptDigest,
    recoveryInput.integratedClaim.integrationReceiptDigest,
  );
  assert.equal(events.filter(event => event === "recover:continue").length, 1);
  assert.equal(events.some(event => event.includes("workflow run auto-delivery.yml")), false);
});

test("expired delivery replay repeats one exact producer-shaped parked recovery suffix", () => {
  const events = [];
  let recoveryInput;
  let recoveredResult;
  const result = runProtectedRefreshScenario({
    leaseStatus: "delivery",
    events,
    deliveryRecovery: {
      repeatExpired: true,
      onRecover: input => { recoveryInput = input; },
      mutateResult: value => {
        recoveredResult = value;
        return value;
      },
    },
    observations: [mergedPullRequest()],
  });

  assert.equal(result.status, "integrated");
  assert.equal(recoveryInput.authority.transitionCounter, 5);
  assert.equal(recoveryInput.integratedClaim.state, "dormant-preserved");
  assert.equal(recoveryInput.integratedClaim.transitionCounter, 6);
  assert.equal(recoveryInput.integratedClaim.expiresAt, "1969-12-31T23:59:59.500Z");
  assert.notEqual(
    recoveryInput.integratedClaim.operationReceiptDigest,
    recoveryInput.integratedClaim.integrationReceiptDigest,
  );
  assert.equal(recoveredResult.authority.transitionCounter, 7);
  assert.equal(recoveredResult.authority.state, "delivery_authorized");
  assert.equal(events.filter(event => event === "recover:continue").length, 1);
});

test("expired delivery replay adopts a live repeated recovery after response loss", () => {
  const events = [];
  let recoveryInput;
  let recoveredResult;
  const result = runProtectedRefreshScenario({
    leaseStatus: "delivery",
    events,
    deliveryRecovery: {
      repeatAlreadyLive: true,
      onRecover: input => { recoveryInput = input; },
      mutateResult: value => {
        recoveredResult = value;
        return value;
      },
    },
    observations: [mergedPullRequest()],
  });

  assert.equal(result.status, "integrated");
  assert.equal(recoveryInput.authority.transitionCounter, 5);
  assert.equal(recoveryInput.integratedClaim.state, "integrated-preserved");
  assert.equal(recoveryInput.integratedClaim.transitionCounter, 7);
  assert.equal(
    recoveredResult.authority.transitionCounter,
    recoveryInput.integratedClaim.transitionCounter,
  );
  assert.equal(
    recoveredResult.authority.operationReceiptDigest,
    recoveryInput.integratedClaim.operationReceiptDigest,
  );
  assert.equal(events.filter(event => event === "recover:continue").length, 1);
});

test("expired delivery repeat recovery rejects counter and receipt or integration drift", () => {
  for (const [label, repeatExpired, mutateObservedClaim] of [
    ["counter regression", true, claim => ({ ...claim, transitionCounter: 4 })],
    ["unsafe counter", true, claim => ({
      ...claim,
      transitionCounter: Number.MAX_SAFE_INTEGER + 1,
    })],
    ["same-counter receipt drift", false, claim => ({
      ...claim,
      operationReceiptDigest: "c".repeat(64),
    })],
    ["reused integration receipt", true, claim => ({
      ...claim,
      operationReceiptDigest: claim.integrationReceiptDigest,
    })],
    ["recycled expiry", true, claim => ({
      ...claim,
      expiresAt: "1969-12-31T23:59:59.000Z",
    })],
    ["recycled fence", true, claim => ({
      ...claim,
      fenceRevision: "6".repeat(64),
    })],
    ["recycled transition digest", true, claim => ({
      ...claim,
      transitionDigest: "9".repeat(64),
    })],
    ["integration drift", true, claim => ({
      ...claim,
      integration: { ...claim.integration, candidateRevision: "0".repeat(40) },
    })],
  ]) {
    const events = [];
    assert.throws(() => runProtectedRefreshScenario({
      leaseStatus: "delivery",
      events,
      deliveryRecovery: { repeatExpired, mutateObservedClaim },
      observations: [],
    }), /requires one exact integrated-preserved cloud claim/u, label);
    assert.equal(events.includes("recover:continue"), false, label);
  }
});

test("expired delivery baseline rejects a drifted local operation receipt", () => {
  const events = [];
  assert.throws(() => runProtectedRefreshScenario({
    leaseStatus: "delivery",
    events,
    deliveryRecovery: { localOperationReceiptDigest: "c".repeat(64) },
    observations: [],
  }), /drifted from its exact local reviewed integration subject/u);
  assert.equal(events.includes("recover:continue"), false);
});

test("expired delivery replay verifies an existing protected-refresh successor without redispatch", () => {
  const events = [];
  const refreshedHeadSha = "2".repeat(40);
  const refreshedMainSha = "3".repeat(40);
  const refreshed = openPullRequest({
    baseRefOid: refreshedMainSha,
    headRefOid: refreshedHeadSha,
    mergeStateStatus: "CLEAN",
  });
  const result = runProtectedRefreshScenario({
    leaseStatus: "delivery",
    events,
    deliveryRecovery: { pullRequests: [refreshed, refreshed] },
    protectedRefresh: {
      headSha: refreshedHeadSha,
      mainSha: refreshedMainSha,
      treeSha: "4".repeat(40),
    },
    livePullRequest: protectedRefreshPullRequest({
      base: {
        ...protectedRefreshPullRequest().base,
        sha: refreshedMainSha,
      },
      head: {
        ...protectedRefreshPullRequest().head,
        sha: refreshedHeadSha,
      },
      mergeable_state: "clean",
    }),
    liveMainRef: protectedRefreshMainRef({
      object: { type: "commit", sha: refreshedMainSha },
    }),
    observations: [mergedPullRequest({ headRefOid: refreshedHeadSha })],
  });

  assert.equal(result.status, "integrated");
  assert.equal(events.filter(event => event === "recover:continue").length, 1);
  assert.equal(events.some(event => event.includes("workflow run auto-delivery.yml")), false);
  assert.equal(result.protectedMainRefresh.deliveredHeadSha, commitSha);
  assert.equal(result.protectedMainRefresh.refreshedHeadSha, refreshedHeadSha);
});

test("expired delivery replay verifies a two-hop protected-refresh successor chain", () => {
  const events = [];
  const firstHeadSha = "2".repeat(40);
  const firstMainSha = "3".repeat(40);
  const finalHeadSha = "5".repeat(40);
  const finalMainSha = "6".repeat(40);
  const refreshed = openPullRequest({
    baseRefOid: finalMainSha,
    headRefOid: finalHeadSha,
    mergeStateStatus: "CLEAN",
  });
  const result = runProtectedRefreshScenario({
    leaseStatus: "delivery",
    events,
    deliveryRecovery: { pullRequests: [refreshed, refreshed] },
    protectedRefresh: {
      headSha: finalHeadSha,
      mainSha: finalMainSha,
      treeSha: "7".repeat(40),
      refreshes: [
        {
          previousHeadSha: commitSha,
          refreshedHeadSha: firstHeadSha,
          mainParentSha: firstMainSha,
          treeSha: "4".repeat(40),
        },
        {
          previousHeadSha: firstHeadSha,
          refreshedHeadSha: finalHeadSha,
          mainParentSha: finalMainSha,
          treeSha: "7".repeat(40),
        },
      ],
    },
    livePullRequest: protectedRefreshPullRequest({
      base: { ...protectedRefreshPullRequest().base, sha: finalMainSha },
      head: { ...protectedRefreshPullRequest().head, sha: finalHeadSha },
      mergeable_state: "clean",
    }),
    liveMainRef: protectedRefreshMainRef({
      object: { type: "commit", sha: finalMainSha },
    }),
    observations: [mergedPullRequest({ headRefOid: finalHeadSha })],
  });

  assert.equal(result.status, "integrated");
  assert.equal(events.some(event => event.includes("workflow run auto-delivery.yml")), false);
  assert.equal(result.protectedMainRefresh.schema, "agentic-protected-main-refresh-chain/v1");
  assert.equal(result.protectedMainRefresh.refreshCount, 2);
  assert.equal(result.protectedMainRefresh.refreshedHeadSha, finalHeadSha);
});

test("expired delivery replay recovers an exact already-merged pull request", () => {
  const events = [];
  const mergedRecovery = mergedPullRequest({
    baseRefOid: baseSha,
    isDraft: false,
    isCrossRepository: false,
    mergeStateStatus: "UNKNOWN",
    autoMergeRequest: null,
  });
  const result = runProtectedRefreshScenario({
    leaseStatus: "delivery",
    events,
    deliveryRecovery: { pullRequests: [mergedRecovery, mergedRecovery] },
    livePullRequest: protectedRefreshPullRequest({
      state: "closed",
      merged: true,
      merged_at: "2026-08-11T09:45:00.000Z",
      merge_commit_sha: mergeSha,
    }),
    observations: [mergedPullRequest()],
  });

  assert.equal(result.status, "integrated");
  assert.equal(events.filter(event => event === "recover:continue").length, 1);
  assert.equal(events.some(event => event.includes("workflow run auto-delivery.yml")), false);
});

test("expired delivery recovery rejects pull-request drift before cloud mutation", () => {
  const events = [];
  assert.throws(() => runProtectedRefreshScenario({
    leaseStatus: "delivery",
    events,
    deliveryRecovery: {
      pullRequests: [openPullRequest({
        baseRefOid: "3".repeat(40),
        mergeStateStatus: "BEHIND",
      })],
    },
    observations: [],
  }), /pull-request evidence drifted/u);
  assert.equal(events.includes("recover:status"), false);
  assert.equal(events.includes("recover:continue"), false);
  assert.equal(events.some(event => event.includes("workflow run auto-delivery.yml")), false);
});

test("expired delivery recovery rejects an unproven protected-main descendant before cloud mutation", () => {
  const events = [];
  assert.throws(() => runProtectedRefreshScenario({
    leaseStatus: "delivery",
    events,
    deliveryRecovery: { mainAncestry: false },
    observations: [],
  }), /protected main diverged/u);
  assert.equal(events.includes("recover:status"), false);
  assert.equal(events.includes("recover:continue"), false);
});

test("expired delivery recovery rejects a refreshed successor on a divergent canonical main", () => {
  const events = [];
  const refreshedHeadSha = "2".repeat(40);
  const refreshedMainSha = "3".repeat(40);
  const refreshed = openPullRequest({
    baseRefOid: refreshedMainSha,
    headRefOid: refreshedHeadSha,
    mergeStateStatus: "CLEAN",
  });
  assert.throws(() => runProtectedRefreshScenario({
    leaseStatus: "delivery",
    events,
    deliveryRecovery: {
      mainAncestry: false,
      pullRequests: [refreshed, refreshed],
    },
    protectedRefresh: {
      headSha: refreshedHeadSha,
      mainSha: refreshedMainSha,
      treeSha: "4".repeat(40),
    },
    livePullRequest: protectedRefreshPullRequest({
      base: { ...protectedRefreshPullRequest().base, sha: refreshedMainSha },
      head: { ...protectedRefreshPullRequest().head, sha: refreshedHeadSha },
      mergeable_state: "clean",
    }),
    liveMainRef: protectedRefreshMainRef({
      object: { type: "commit", sha: refreshedMainSha },
    }),
    observations: [],
  }), /protected main diverged/u);
  assert.equal(events.includes("recover:status"), false);
  assert.equal(events.includes("recover:continue"), false);
});

test("expired delivery recovery rejects fetched protected-main drift before cloud mutation", () => {
  const events = [];
  assert.throws(() => runProtectedRefreshScenario({
    leaseStatus: "delivery",
    events,
    deliveryRecovery: { fetchedMainSha: "8".repeat(40) },
    observations: [],
  }), /provider and Git evidence diverged/u);
  assert.ok(events.includes("run:git fetch origin main"));
  assert.ok(events.includes("verify:recovery-fetched-main"));
  assert.equal(events.includes("recover:status"), false);
  assert.equal(events.includes("recover:continue"), false);
});

test("expired delivery recovery rejects exact PR revocation after cloud convergence", () => {
  const events = [];
  const armed = openPullRequest({ baseRefOid: baseSha, mergeStateStatus: "BEHIND" });
  assert.throws(() => runProtectedRefreshScenario({
    leaseStatus: "delivery",
    events,
    deliveryRecovery: {
      pullRequests: [armed, { ...armed, autoMergeRequest: null }],
    },
    observations: [],
  }), /pull-request evidence drifted/u);
  assert.equal(events.filter(event => event === "recover:continue").length, 1);
  assert.equal(events.some(event => event.includes("workflow run auto-delivery.yml")), false);
});

test("expired delivery recovery rejects a drifted recovered authority before dispatch", () => {
  const events = [];
  assert.throws(() => runProtectedRefreshScenario({
    leaseStatus: "delivery",
    events,
    deliveryRecovery: {
      mutateResult: result => ({
        ...result,
        authority: { ...result.authority, laneRevision: "3".repeat(40) },
      }),
    },
    observations: [],
  }), /exact verified same-claim convergence evidence/u);
  assert.equal(events.filter(event => event === "recover:continue").length, 1);
  assert.equal(events.filter(event => event.startsWith("read:recovery:")).length, 2);
  assert.equal(events.includes(`verify:${commitSha}`), false);
  assert.equal(events.some(event => event.includes("workflow run auto-delivery.yml")), false);
});

test("delivery replay rejects protected-refresh projection drift before dispatch", () => {
  const events = [];
  assert.throws(() => runProtectedRefreshScenario({
    leaseStatus: "delivery",
    events,
    observations: [openPullRequest({ mergeStateStatus: "BEHIND" })],
    livePullRequest: protectedRefreshPullRequest({
      base: {
        ...protectedRefreshPullRequest().base,
        sha: "3".repeat(40),
      },
    }),
  }), /metadata drifted from the accepted head or canonical base/u);
  assert.equal(events.some(event => event.includes("workflow run auto-delivery.yml")), false);
  assert.equal(events.some(event => event.startsWith("run:gh pr merge --auto")), false);
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

test("authorized and legacy local-only auto-delivery complete only through canonical runtime readiness", () => {
  for (const legacyLocalOnly of [false, true]) {
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
  if (legacyLocalOnly) {
    delete lease.admission;
    delete lease.cloudAuthority;
  }
  let publishCalled = false;
  let runtimeProven = false;
  let completedAfterRuntime = false;
  let cloudAuthorizationCalls = 0;
  let cloudVerificationCalls = 0;
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
      authorizeCloudDelivery: ({ authority }) => {
        cloudAuthorizationCalls += 1;
        return { authority: deliveryAuthorizedAuthority(authority) };
      },
      verifyCloudAuthority: () => {
        cloudVerificationCalls += 1;
        return { ok: true };
      },
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
    assert.equal(cloudAuthorizationCalls, legacyLocalOnly ? 0 : 1);
    assert.equal(cloudVerificationCalls === 0, legacyLocalOnly);
  } finally {
    rmSync(repo, { recursive: true, force: true });
  }
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
  leaseStatus = "review_ready",
  deliveryRecovery = null,
  observations,
  events = [],
  onVerify = null,
  onRun = null,
  failAutoMerge = false,
  autoMergeReplay = null,
  protectedRefresh = null,
  staleDeliveryHeadSha = null,
  initialPullRequest = null,
  terminalMergedReplay = false,
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
  const reviewedLease = createLease({
    repo,
    status: "review_ready",
    autoDelivery: false,
    runtimeRequired: false,
    reviewHeadSha: commitSha,
    ...(staleDeliveryHeadSha ? { deliveryHeadSha: staleDeliveryHeadSha } : {}),
    pullRequestUrl: pullUrl,
  });
  const recoveryFixture = deliveryRecovery
    ? expiredDeliveryRecoveryFixture(reviewedLease, deliveryRecovery)
    : null;
  let lease = leaseStatus === "delivery"
    ? {
      ...reviewedLease,
      status: "delivery",
      deliveryHeadSha: commitSha,
      ...(recoveryFixture ? {
        admission: recoveryFixture.admission,
        cloudAuthority: recoveryFixture.authority,
      } : {
        cloudAuthority: {
          ...deliveryAuthorizedAuthority(reviewedLease.cloudAuthority),
          expiresAt: "2099-08-11T12:00:00.000Z",
        },
      }),
    }
    : reviewedLease;
  let initialPullRequestRead = leaseStatus === "delivery";
  let recoveryPullRequestRead = 0;
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
        if (recoveryFixture && key === `merge-base --is-ancestor ${baseSha} origin/main`) {
          events.push("verify:recovery-main-ancestor");
          if (deliveryRecovery.mainAncestry === false) {
            throw new Error("protected main is not a descendant");
          }
          return "";
        }
        if (recoveryFixture && key === "rev-parse origin/main") {
          events.push("verify:recovery-fetched-main");
          return deliveryRecovery.fetchedMainSha || liveMainRef.object.sha;
        }
        if (key === `rev-parse ${commitSha}^{tree}`) return treeSha;
        if (key === `log --first-parent --no-merges -1 --format=%s ${baseSha}..${commitSha}`) {
          return protectedSquashSubject;
        }
        if (protectedRefresh) {
          const refreshSteps = protectedRefresh.refreshes || [{
            previousHeadSha: commitSha,
            refreshedHeadSha: protectedRefresh.headSha,
            mainParentSha: protectedRefresh.mainSha,
            treeSha: protectedRefresh.treeSha,
          }];
          if (key === "rev-parse FETCH_HEAD") return protectedRefresh.headSha;
          const parentStep = refreshSteps.find(step =>
            key === `rev-list --parents -n 1 ${step.refreshedHeadSha}`);
          if (parentStep) {
            return `${parentStep.refreshedHeadSha} ${parentStep.previousHeadSha} ${parentStep.mainParentSha}`;
          }
          if (refreshSteps.some(step =>
            key === `merge-base --is-ancestor ${step.mainParentSha} origin/main`)) return "";
          const mergeStep = refreshSteps.find(step => key ===
            `merge-tree --write-tree --no-messages ${step.previousHeadSha} ${step.mainParentSha}`);
          if (mergeStep) return mergeStep.treeSha;
          const treeStep = refreshSteps.find(step =>
            key === `rev-parse ${step.refreshedHeadSha}^{tree}`);
          if (treeStep) return treeStep.treeSha;
          if (key === "rev-parse HEAD") return head;
          if (key === "status --porcelain") return "";
        }
        throw new Error(`unexpected git command: ${key}`);
      },
      ghText: args => {
        const key = args.join(" ");
        const recoveryFields =
          "state,baseRefName,baseRefOid,url,headRefOid,mergeCommit,isDraft,isCrossRepository,mergeStateStatus,autoMergeRequest";
        if (recoveryFixture && key === `pr view ${pullUrl} --json ${recoveryFields}`) {
          const pullRequest = recoveryFixture.pullRequests[recoveryPullRequestRead++];
          if (!pullRequest) throw new Error("expired delivery fixture exhausted PR recovery observations");
          events.push(`read:recovery:${recoveryPullRequestRead}`);
          return JSON.stringify({ ...pullRequest, url: pullUrl });
        }
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
          pullRequest = initialPullRequest
            || openPullRequest({ url: pullUrl, mergeStateStatus: "CLEAN" });
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
      inspectCloudStatus: input => {
        if (!recoveryFixture) throw new Error("unexpected delivery cloud-status inspection");
        events.push("recover:status");
        assert.equal(input.action, "status");
        return recoveryFixture.status;
      },
      recoverIntegratedCloudAuthority: input => {
        if (!recoveryFixture) throw new Error("unexpected integrated-preserved recovery");
        events.push("recover:continue");
        recoveryFixture.onRecover?.(input);
        return recoveryFixture.result;
      },
      buildDeliveryEvidence: () => {
        events.push("build:delivery-evidence");
        if (leaseStatus === "delivery") {
          throw new Error("delivery replay must not rebuild delivery evidence");
        }
        return deliveryEvidence;
      },
      authorizeCloudDelivery: ({ authority, headSha }) => {
        events.push("authorize:delivery");
        if (leaseStatus === "delivery") {
          throw new Error("delivery replay must not authorize delivery twice");
        }
        if (terminalMergedReplay) {
          throw new Error("Cloud reconciliation requires exactly one live candidate claim.");
        }
        return { authority: deliveryAuthorizedAuthority(authority, headSha) };
      },
      verifyCloudAuthority: input => {
        const { headSha } = input;
        events.push(`verify:${headSha}`);
        onVerify?.(input);
        if (terminalMergedReplay) {
          return {
            schema: "agentic-post-merge-cloud-authority-verification/v1",
            ok: true,
            status: "integrated-retired",
          };
        }
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

function expiredDeliveryRecoveryFixture(reviewedLease, options = {}) {
  const manifest = normalizeDeclaredWriteScopeManifest({
    schema: "agentic-declared-write-scope/v1",
    semanticScope: "runtime-integration",
    paths: ["scripts/runtime.mjs"],
  }, { expectedScope: "runtime-integration" });
  const admission = Object.freeze({
    schema: "agentic-lane-admission-lease/v1",
    status: "admitted",
    semanticScope: manifest.semanticScope,
    declaredWriteSet: manifest.declaredWriteSet,
    writeSetDigest: manifest.writeSetDigest,
    manifestDigest: manifest.manifestDigest,
    planReceiptDigest: "1".repeat(64),
    admissionReceiptDigest: "2".repeat(64),
    existingLaneStateDigest: "3".repeat(64),
    admittedReportDigest: "4".repeat(64),
    preservationReceiptDigest: "5".repeat(64),
  });
  const identity = Object.freeze({
    actorId: "github-user:actor",
    canonicalBaseRevision: baseSha,
    leaseEpoch: 2,
    repositoryId: "github-repository:repo",
    workItemId: "work-item:history-lifecycle",
    writeSetDigest: manifest.writeSetDigest,
  });
  const recoveredClaimId = digestValue(identity);
  const integration = Object.freeze({
    candidateRevision: commitSha,
    reviewRequestId,
    focusedEvidenceDigest,
    ...deliveryEvidence,
    integratedAt: "2026-08-11T08:45:00.000Z",
  });
  const authority = Object.freeze({
    ...deliveryAuthorizedAuthority(reviewedLease.cloudAuthority),
    provider: "github",
    ledgerRepository: "example/ledger",
    targetRepository: "example/repo",
    claimId: recoveredClaimId,
    claimDigest: "6".repeat(64),
    ledgerRevision: "7".repeat(40),
    ledgerDigest: "8".repeat(64),
    claimLedgerRevision: "9".repeat(64),
    entrySchema: "agentic-cloud-collaboration-entry/v2",
    claimIdentitySchema: "agentic-cloud-collaboration-entry/v2",
    operationReceiptDigest: options.localOperationReceiptDigest || "7".repeat(64),
    canonicalBaseSha: baseSha,
    laneRevision: commitSha,
    cloudDeclaredWriteScope: manifest.declaredWriteSet,
    writeSetDigest: manifest.writeSetDigest,
    deviceId: reviewedLease.device,
    sessionId: reviewedLease.sessionId,
    reviewRequestId,
    leaseEpoch: 2,
    transitionCounter: 5,
    state: "delivery_authorized",
    expiresAt: "1969-12-31T23:59:59.000Z",
    focusedEvidenceDigest,
    manifestDigest: manifest.manifestDigest,
    integrationReceiptDigest: "7".repeat(64),
    integration,
  });
  const parkedClaim = Object.freeze({
    claimId: recoveredClaimId,
    entrySchema: authority.entrySchema,
    claimIdentitySchema: authority.claimIdentitySchema,
    state: "dormant-preserved",
    ...identity,
    laneRevision: commitSha,
    declaredWriteScope: manifest.declaredWriteSet,
    transitionCounter: 5,
    heartbeatCounter: 0,
    reviewRequestId,
    predecessorClaimId: null,
    expiresAt: authority.expiresAt,
    fenceRevision: authority.claimDigest,
    transitionDigest: authority.claimLedgerRevision,
    operationReceiptDigest: authority.integrationReceiptDigest,
    integrationReceiptDigest: authority.integrationReceiptDigest,
    integration,
  });
  const liveClaim = Object.freeze({
    ...parkedClaim,
    state: "integrated-preserved",
    transitionCounter: 6,
    expiresAt: "2099-08-11T12:30:00.000Z",
    fenceRevision: "a".repeat(64),
    transitionDigest: "b".repeat(64),
    operationReceiptDigest: "c".repeat(64),
  });
  const repeatParkedClaim = Object.freeze({
    ...liveClaim,
    state: "dormant-preserved",
    expiresAt: "1969-12-31T23:59:59.500Z",
  });
  const repeatedLiveClaim = Object.freeze({
    ...liveClaim,
    transitionCounter: 7,
    fenceRevision: "d".repeat(64),
    transitionDigest: "e".repeat(64),
    operationReceiptDigest: "f".repeat(64),
  });
  const selectedClaim = options.repeatAlreadyLive
    ? repeatedLiveClaim
    : options.repeatExpired ? repeatParkedClaim
      : options.alreadyLive ? liveClaim : parkedClaim;
  const observedClaim = Object.freeze(options.mutateObservedClaim
    ? options.mutateObservedClaim(selectedClaim)
    : selectedClaim);
  const recoveredClaim = options.repeatExpired || options.repeatAlreadyLive
    ? repeatedLiveClaim
    : liveClaim;
  const nextAuthority = Object.freeze({
    ...authority,
    claimDigest: recoveredClaim.fenceRevision,
    ledgerRevision: "d".repeat(40),
    ledgerDigest: "e".repeat(64),
    claimLedgerRevision: recoveredClaim.transitionDigest,
    operationReceiptDigest: recoveredClaim.operationReceiptDigest,
    transitionCounter: recoveredClaim.transitionCounter,
    expiresAt: recoveredClaim.expiresAt,
  });
  const verification = Object.freeze({
    schema: "agentic-lane-cloud-verification/v1",
    status: "ready",
    claimId: nextAuthority.claimId,
    claimDigest: nextAuthority.claimDigest,
    ledgerRevision: nextAuthority.ledgerRevision,
    ledgerDigest: nextAuthority.ledgerDigest,
    canonicalBaseSha: nextAuthority.canonicalBaseSha,
    laneRevision: nextAuthority.laneRevision,
    writeSetDigest: nextAuthority.writeSetDigest,
    reviewRequestId: nextAuthority.reviewRequestId,
    receiptDigest: "f".repeat(64),
  });
  const convergenceEvidence = Object.freeze({
    schema: "agentic-integrated-replay-convergence-evidence/v1",
    claimId: nextAuthority.claimId,
    claimDigest: nextAuthority.claimDigest,
    fenceRevision: nextAuthority.claimDigest,
    claimLedgerRevision: nextAuthority.claimLedgerRevision,
    transitionDigest: nextAuthority.claimLedgerRevision,
    transitionCounter: nextAuthority.transitionCounter,
    state: nextAuthority.state,
    expiresAt: nextAuthority.expiresAt,
    branch,
    canonicalBaseSha: nextAuthority.canonicalBaseSha,
    candidateRevision: nextAuthority.laneRevision,
    manifestDigest: admission.manifestDigest,
    writeSetDigest: nextAuthority.writeSetDigest,
    leaseEpoch: nextAuthority.leaseEpoch,
    reviewRequestId: nextAuthority.reviewRequestId,
    focusedEvidenceDigest: nextAuthority.focusedEvidenceDigest,
    currentOperationReceiptDigest: nextAuthority.operationReceiptDigest,
    integrationReceiptDigest: nextAuthority.integrationReceiptDigest,
    integrationEvidenceDigest: digestValue(nextAuthority.integration),
    currentQueuedDerivativeDisposition: "absent-from-verified-inventory",
    overlappingCurrentClaimIds: [],
    lifecycleAttribution: "not-reconstructed",
    observation: "current-state-only",
  });
  const defaultPullRequest = openPullRequest({ baseRefOid: baseSha, mergeStateStatus: "BEHIND" });
  const defaultResult = Object.freeze({
    authority: nextAuthority,
    verification,
    convergenceEvidence,
    convergenceEvidenceDigest: digestValue(convergenceEvidence),
  });
  return {
    admission,
    authority,
    status: Object.freeze({
      schema: "agentic-cloud-collaboration-result/v1",
      ok: true,
      action: "status",
      status: "ready",
      ledgerRevision: "7".repeat(40),
      ledgerDigest: "8".repeat(64),
      claims: [observedClaim],
    }),
    result: options.mutateResult ? options.mutateResult(defaultResult) : defaultResult,
    pullRequests: options.pullRequests || [defaultPullRequest, defaultPullRequest],
    onRecover: options.onRecover || null,
    observedClaim,
  };
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
  sourcePredecessor = null,
  durableCas = false,
  ancestorPasses = Number.POSITIVE_INFINITY,
  crashPhase = null,
  expiredSuccessor = false,
  derivativeFault = null,
  providerEpochDemand = null,
  providerLedgerDrift = false,
  laggingPullRequestBase = false,
  authorityManifestProjection = "canonical",
  preparedBaseRollover = null,
  normalizedSourceAuthorityOwner = false,
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
  const sourceCloudDeviceId = pseudonymousIdentifier("device", "device-a");
  const sourceCloudSessionId = pseudonymousIdentifier("session", "session-a");
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
  const fallbackManifestDigest = digestValue({
    declaredWriteSet: manifest.declaredWriteSet,
    writeSetDigest: manifest.writeSetDigest,
  });
  const sourceManifestDigest = ({
    canonical: manifest.manifestDigest,
    fallback: fallbackManifestDigest,
    arbitrary: "0".repeat(64),
  })[authorityManifestProjection];
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
    deviceId: normalizedSourceAuthorityOwner ? sourceCloudDeviceId : "device-a",
    sessionId: normalizedSourceAuthorityOwner ? sourceCloudSessionId : "session-a",
    reviewRequestId,
    leaseEpoch: 1,
    transitionCounter: 2,
    state: "active",
    expiresAt,
    integrationReceiptDigest: null,
    integration: null,
    manifestDigest: sourceManifestDigest,
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
    deviceId: sourceCloudDeviceId,
    sessionId: sourceCloudSessionId,
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
    writeAuthority: true,
    scopeReserved: true,
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
    deviceId: "device-a",
    sessionId: "session-a",
    canonicalBaseSha: mainSha,
    laneRevision: successorHeadSha,
    leaseEpoch: 2,
    transitionCounter: 2,
    expiresAt: successorExpiresAt,
    manifestDigest: manifest.manifestDigest,
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
  const descendantBaseSha = "7".repeat(40);
  const descendantHeadSha = "9".repeat(40);
  const rolloverOptions = {
    mergeBases: [mainSha],
    authoredPaths: ["scripts/runtime.mjs"],
    protectedPaths: ["docs/protected-main.md"],
    pullRequestBaseAfterAdvance: "protected",
    pullRequestBaseAfterV2Cas: null,
    protectedObjectAvailable: true,
    fetchProtectedObjectFails: false,
    postFetchBaseDrift: false,
    postFetchPullRequestBaseDrift: false,
    loseCasResponse: false,
    loseCloudResponse: false,
    loseCloudResponsePhase: null,
    protectedDerivativeRetainsSource: false,
    dormantPredecessor: false,
    dormantPredecessorAfterV2Cas: false,
    dormantPredecessorOverrides: null,
    ledgerDigestAfterV2Cas: null,
    legacyProtectedDerivativeAfterV2Cas: null,
    rolloverClaimReplayWrongParent: false,
    doublePrefixClaimReplayStale: false,
    rolloverSourceRetirementDrift: false,
    rolloverDerivativeOwnerOverrides: null,
    rolloverClaimReplayOwnerOverrides: null,
    postCasDrift: null,
    postCasCloudPhase: null,
    descendantIsAncestor: true,
    ...(preparedBaseRollover || {}),
  };
  const intermediateBaseSha = "5".repeat(40);
  const postCasProtectedBaseSha = "6".repeat(40);
  const preparedPullRequestBase = value => ({
    historical: mainSha,
    protected: secondBaseSha,
    descendant: descendantBaseSha,
    intermediate: intermediateBaseSha,
  })[value] || value;
  const rolloverClaimId = "0".repeat(64);
  const rolloverClaimDigest = "1".repeat(64);
  const rolloverLedgerRevision = "6".repeat(40);
  const rolloverLedgerDigest = "7".repeat(64);
  const rolloverClaimLedgerRevision = "8".repeat(64);
  const rolloverOperationReceiptDigest = "9".repeat(64);
  const rolloverSuccessorAuthority = Object.freeze({
    ...successorAuthority,
    claimId: rolloverClaimId,
    claimDigest: rolloverClaimDigest,
    ledgerRevision: rolloverLedgerRevision,
    ledgerDigest: rolloverLedgerDigest,
    claimLedgerRevision: rolloverClaimLedgerRevision,
    operationReceiptDigest: rolloverOperationReceiptDigest,
    canonicalBaseSha: secondBaseSha,
    laneRevision: successorHeadSha,
  });
  const rolloverLiveSuccessor = Object.freeze({
    ...liveSuccessor,
    claimId: rolloverClaimId,
    predecessorClaimId: claimId,
    canonicalBaseRevision: secondBaseSha,
    laneRevision: successorHeadSha,
    fenceRevision: rolloverClaimDigest,
    transitionDigest: rolloverClaimLedgerRevision,
    operationReceiptDigest: rolloverOperationReceiptDigest,
  });
  const rolloverWaitingSuccessor = Object.freeze({
    ...waitingSuccessor,
    claimId: rolloverClaimId,
    canonicalBaseRevision: secondBaseSha,
    laneRevision: secondBaseSha,
    fenceRevision: "a".repeat(64),
    transitionDigest: "b".repeat(64),
    operationReceiptDigest: "c".repeat(64),
  });
  const rolloverCurrentBaseSuccessor = Object.freeze({
    ...rolloverWaitingSuccessor,
    state: "current",
    transitionCounter: 2,
    fenceRevision: "d".repeat(64),
    transitionDigest: "e".repeat(64),
    operationReceiptDigest: "f".repeat(64),
  });
  const rolloverWaitingHeadSuccessor = Object.freeze({
    ...rolloverWaitingSuccessor,
    laneRevision: successorHeadSha,
  });
  const rolloverCurrentHeadSuccessor = Object.freeze({
    ...rolloverCurrentBaseSuccessor,
    laneRevision: successorHeadSha,
  });
  const rolloverRetiredSource = Object.freeze({
    ...predecessor,
    state: "retired",
    writeAuthority: false,
    scopeReserved: false,
    transitionCounter: predecessor.transitionCounter + 1,
    fenceRevision: "2".repeat(64),
    transitionDigest: "3".repeat(64),
    operationReceiptDigest: "4".repeat(64),
  });
  const rolloverVerifiedClaim = Object.freeze({ ...rolloverLiveSuccessor, state: "active" });
  const rolloverInventoryCore = Object.freeze({
    schema: "agentic-cloud-claim-inventory/v1",
    observedLedgerHeadRevision: rolloverLedgerRevision,
    ledgerDigest: rolloverLedgerDigest,
    evaluationTime: "2026-08-11T04:00:00.000Z",
    claims: [rolloverVerifiedClaim],
  });
  const rolloverInventory = Object.freeze({
    ...rolloverInventoryCore,
    inventoryDigest: digestValue(rolloverInventoryCore),
  });
  const rolloverSuccessor = Object.freeze({
    authority: rolloverSuccessorAuthority,
    verification: Object.freeze({
      ...successor.verification,
      claimId: rolloverClaimId,
      claimDigest: rolloverClaimDigest,
      ledgerRevision: rolloverLedgerRevision,
      ledgerDigest: rolloverLedgerDigest,
      canonicalBaseSha: secondBaseSha,
      laneRevision: successorHeadSha,
      remoteClaimInventoryDigest: rolloverInventory.inventoryDigest,
      inventory: rolloverInventory,
      receiptDigest: "0".repeat(64),
    }),
  });
  const descendantClaimId = "4".repeat(64);
  const descendantClaimDigest = "5".repeat(64);
  const descendantLedgerRevision = "6".repeat(40);
  const descendantLedgerDigest = "6".repeat(64);
  const descendantClaimLedgerRevision = "7".repeat(64);
  const descendantOperationReceiptDigest = "8".repeat(64);
  const descendantSuccessorAuthority = Object.freeze({
    ...rolloverSuccessorAuthority,
    claimId: descendantClaimId,
    claimDigest: descendantClaimDigest,
    ledgerRevision: descendantLedgerRevision,
    ledgerDigest: descendantLedgerDigest,
    claimLedgerRevision: descendantClaimLedgerRevision,
    operationReceiptDigest: descendantOperationReceiptDigest,
    canonicalBaseSha: descendantBaseSha,
    laneRevision: descendantHeadSha,
    leaseEpoch: 3,
  });
  const descendantLiveSuccessor = Object.freeze({
    ...rolloverLiveSuccessor,
    claimId: descendantClaimId,
    predecessorClaimId: rolloverClaimId,
    canonicalBaseRevision: descendantBaseSha,
    laneRevision: descendantHeadSha,
    leaseEpoch: 3,
    fenceRevision: descendantClaimDigest,
    transitionDigest: descendantClaimLedgerRevision,
    operationReceiptDigest: descendantOperationReceiptDigest,
  });
  const descendantVerifiedClaim = Object.freeze({
    ...descendantLiveSuccessor,
    state: "active",
  });
  const descendantInventoryCore = Object.freeze({
    schema: "agentic-cloud-claim-inventory/v1",
    observedLedgerHeadRevision: descendantLedgerRevision,
    ledgerDigest: descendantLedgerDigest,
    evaluationTime: "2026-08-11T04:00:00.000Z",
    claims: [descendantVerifiedClaim],
  });
  const descendantInventory = Object.freeze({
    ...descendantInventoryCore,
    inventoryDigest: digestValue(descendantInventoryCore),
  });
  const descendantSuccessor = Object.freeze({
    authority: descendantSuccessorAuthority,
    verification: Object.freeze({
      ...rolloverSuccessor.verification,
      claimId: descendantClaimId,
      claimDigest: descendantClaimDigest,
      ledgerRevision: descendantLedgerRevision,
      ledgerDigest: descendantLedgerDigest,
      canonicalBaseSha: descendantBaseSha,
      laneRevision: descendantHeadSha,
      remoteClaimInventoryDigest: descendantInventory.inventoryDigest,
      inventory: descendantInventory,
      receiptDigest: "d".repeat(64),
    }),
  });
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
  const cloudStatus = (claims, ledgerDigestOverride = null) => Object.freeze({
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action: "status",
    status: "ready",
    ledgerRevision: claims.some(claim => claim?.claimId === predecessor.claimId)
      ? ledgerRevision : "4".repeat(40),
    ledgerDigest: ledgerDigestOverride ||
      (claims.some(claim => claim?.claimId === predecessor.claimId)
        ? sourceLedgerDigest : "5".repeat(64)),
    claims,
  });
  const calls = {
    successor: [], bind: [], verify: [], cas: [], run: [], invoke: [], git: [], status: [],
    timeline: [],
  };
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
  let pullRequestBody = updateWriterLeasePullRequestBody("", sourceLease);
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
  let preparedRolloverActive = false;
  let rolloverCloudTarget = "historical";
  let rolloverCasResponseLost = false;
  let rolloverCloudResponseLost = false;
  let rolloverNamedLineage = false;
  let activeRolloverClaimReplay = false;
  let protectedObjectAvailable = rolloverOptions.protectedObjectAvailable;
  let pullRequestId = pullRequestNodeId;
  const initialPredecessor = sourcePredecessor
    ? Object.freeze({ ...predecessor, ...sourcePredecessor })
    : predecessor;
  const preparedDormantPredecessor = Object.freeze({
    ...predecessor,
    state: "dormant-preserved",
    writeAuthority: false,
    scopeReserved: true,
    ...(rolloverOptions.dormantPredecessorOverrides || {}),
  });
  const v2IntentIsDurable = () => lease.activePublishSuccessorIntent?.schema ===
    "agentic-active-publish-successor-intent/v2";
  const activePredecessor = () => {
    if (!preparedRolloverActive) return initialPredecessor;
    const dormant = rolloverOptions.dormantPredecessor ||
      (rolloverOptions.dormantPredecessorAfterV2Cas && v2IntentIsDurable());
    return dormant ? preparedDormantPredecessor : predecessor;
  };
  const rolloverOwnerProjection = claim => ({
    ...claim,
    ...(rolloverOptions.rolloverDerivativeOwnerOverrides || {}),
  });
  const rolloverWaitingProjection = () => rolloverOwnerProjection(rolloverNamedLineage
    ? rolloverWaitingHeadSuccessor
    : rolloverWaitingSuccessor);
  const rolloverCurrentProjection = () => rolloverOwnerProjection(rolloverNamedLineage
    ? rolloverCurrentHeadSuccessor
    : rolloverCurrentBaseSuccessor);
  const rolloverBoundProjection = () => rolloverOwnerProjection(rolloverLiveSuccessor);
  const activeSuccessor = () => preparedRolloverActive ? rolloverSuccessor
    : (activeRound === 1 ? successor : secondSuccessor);
  const fixture = {
    calls,
    sourceAdmission,
    sourceAuthority,
    sourceLease,
    get predecessor() { return activePredecessor(); },
    get rolloverNamedLineage() { return rolloverNamedLineage; },
    get rolloverWaitingClaim() { return rolloverWaitingProjection(); },
    get rolloverRetiredSource() { return rolloverRetiredSource; },
    get successor() { return activeSuccessor(); },
    rolloverBaseSha: secondBaseSha,
    rolloverHeadSha: successorHeadSha,
    descendantBaseSha,
    descendantHeadSha,
    descendantSuccessor,
    workItemId,
    leaseStore,
    get lease() { return lease; },
    get headSha() { return headSha; },
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
    advancePreparedCanonicalBase() {
      preparedRolloverActive = true;
      canonicalHeadSha = secondBaseSha;
      refreshHeadSha = successorHeadSha;
      pullRequestBaseSha = preparedPullRequestBase(
        rolloverOptions.pullRequestBaseAfterAdvance,
      );
      pullRequestHeadSha = successorHeadSha;
      remoteHeadSha = successorHeadSha;
      ancestorReads = 0;
    },
    advancePreparedProtectedDescendant({ pullRequestBase = "historical" } = {}) {
      canonicalHeadSha = descendantBaseSha;
      refreshHeadSha = descendantHeadSha;
      pullRequestBaseSha = preparedPullRequestBase(pullRequestBase);
      pullRequestHeadSha = successorHeadSha;
      remoteHeadSha = successorHeadSha;
      protectedObjectAvailable = true;
      ancestorReads = 0;
    },
    replacePreparedIntent(activePublishSuccessorIntent) {
      assert.ok(leaseStore, "prepared intent replacement requires a durable fixture");
      const projected = casWriterLeaseProjection({
        leaseStore,
        branch,
        expectedLeaseDigest: digestValue(lease),
        expectedClaimId: lease.cloudAuthority.claimId,
        values: { status: "active", activePublishSuccessorIntent },
      });
      lease = projected.lease;
    },
    refreshSourceLedgerProjection({
      ledgerRevision: refreshedLedgerRevision = "9".repeat(40),
      ledgerDigest: refreshedLedgerDigest = "0".repeat(64),
    } = {}) {
      assert.ok(leaseStore, "ledger projection refresh requires a durable fixture");
      const projected = casWriterLeaseProjection({
        leaseStore,
        branch,
        expectedLeaseDigest: digestValue(lease),
        expectedClaimId: lease.cloudAuthority.claimId,
        values: {
          status: "active",
          cloudAuthority: {
            ...lease.cloudAuthority,
            ledgerRevision: refreshedLedgerRevision,
            ledgerDigest: refreshedLedgerDigest,
          },
        },
      });
      lease = projected.lease;
    },
    clearPullRequestMarker() {
      pullRequestBody = "";
    },
    integrate({ publishTask, ...integrationOptions }) {
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
          calls.git.push(key);
          if (key === "branch --show-current") return branch;
          if (key === "worktree list --porcelain -z") return canonicalWorktree(repo);
          if (key === "diff --name-only -z HEAD --" ||
              key === "ls-files --others --exclude-standard -z" || key === "status --porcelain") return "";
          if (key === "rev-parse HEAD") return headSha;
          if (key === `diff --name-only -z ${canonicalHeadSha}..${refreshHeadSha} --`) {
            return "scripts/runtime.mjs\0";
          }
          if (preparedRolloverActive &&
              key === `merge-base --all ${secondBaseSha} ${successorHeadSha}`) {
            return rolloverOptions.mergeBases.join("\n");
          }
          if (preparedRolloverActive &&
              key === `cat-file -e ${secondBaseSha}^{commit}`) {
            if (!protectedObjectAvailable) throw new Error("missing protected-base object");
            return "";
          }
          if (preparedRolloverActive &&
              key === `cat-file -e ${descendantBaseSha}^{commit}`) {
            if (!protectedObjectAvailable) throw new Error("missing protected-base object");
            return "";
          }
          if (preparedRolloverActive &&
              key === `merge-base --is-ancestor ${secondBaseSha} ${descendantBaseSha}`) {
            if (!rolloverOptions.descendantIsAncestor) {
              throw new Error("sealed protected base is not an ancestor");
            }
            return "";
          }
          if (preparedRolloverActive &&
              key === `merge-base --all ${descendantBaseSha} ${successorHeadSha}`) {
            return rolloverOptions.mergeBases.join("\n");
          }
          if (preparedRolloverActive &&
              key === `diff --name-only --no-renames -z ${mainSha}..${successorHeadSha} --`) {
            return `${rolloverOptions.authoredPaths.join("\0")}\0`;
          }
          if (preparedRolloverActive &&
              key === `diff --name-only --no-renames -z ${mainSha}..${secondBaseSha} --`) {
            return `${rolloverOptions.protectedPaths.join("\0")}\0`;
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
              "id,url,state,isDraft,baseRefName,baseRefOid,headRefName,headRefOid,headRepository,body",
          );
          return JSON.stringify({
            id: pullRequestId,
            url: pullRequestUrl,
            state: "OPEN",
            isDraft: true,
            baseRefName: "main",
            baseRefOid: pullRequestBaseSha,
            headRefName: branch,
            headRefOid: pullRequestHeadSha,
            headRepository: { nameWithOwner: sourceAuthority.targetRepository },
            body: pullRequestBody,
          });
        },
        run: (command, args) => {
          const key = [command, ...args].join(" ");
          calls.run.push(key);
          if (key === `git fetch --no-tags --no-write-fetch-head origin ${secondBaseSha}`) {
            if (rolloverOptions.fetchProtectedObjectFails) {
              throw new Error("simulated exact protected-base fetch failure");
            }
            protectedObjectAvailable = true;
            if (rolloverOptions.postFetchBaseDrift) {
              canonicalHeadSha = postCasProtectedBaseSha;
              pullRequestBaseSha = canonicalHeadSha;
            }
            if (rolloverOptions.postFetchPullRequestBaseDrift) {
              pullRequestBaseSha = intermediateBaseSha;
            }
          }
          if (key === `git merge -m ${refreshMergeMessage(
            protectedSquashSubject,
            lease.cloudAuthority.leaseEpoch,
          )} origin/main`) headSha = refreshHeadSha;
        },
        runText: () => "",
        publishTask,
        completeTask: () => { throw new Error("successor fixture must stop during publish"); },
        ...(providerEpochDemand || providerLedgerDrift ? {} : { refreshActiveCloudSuccessor: input => {
          calls.successor.push(input);
          calls.timeline.push({ kind: "successor", canonicalBaseSha: input.canonicalBaseSha });
          if (input.activePublishRequiredReplayClaimId &&
              !input.activePublishClaimReplayOnly) {
            activeRolloverClaimReplay = true;
            try {
              input.invoke({
                action: "claim",
                ledgerRepository: input.ledgerRepository,
                request: {
                  canonicalBaseSha: input.canonicalBaseSha,
                  headSha: input.predecessorClaimId
                    ? input.headSha
                    : input.canonicalBaseSha,
                  leaseEpoch: input.leaseEpoch,
                  ...(input.predecessorClaimId
                    ? { predecessorClaimId: input.predecessorClaimId }
                    : {}),
                },
              });
            } finally {
              activeRolloverClaimReplay = false;
            }
          }
          if (input.activePublishClaimReplayOnly) {
            activeRolloverClaimReplay = true;
            try {
              return input.invoke({
                action: "claim",
                ledgerRepository: input.ledgerRepository,
                request: {
                  canonicalBaseSha: input.canonicalBaseSha,
                  headSha: input.predecessorClaimId
                    ? input.headSha
                    : input.canonicalBaseSha,
                  leaseEpoch: input.leaseEpoch,
                  ...(input.predecessorClaimId
                    ? { predecessorClaimId: input.predecessorClaimId }
                    : {}),
                },
              });
            } finally {
              activeRolloverClaimReplay = false;
            }
          }
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
          if (input.canonicalBaseSha === descendantBaseSha) {
            rolloverCloudTarget = "descendant";
          } else if (preparedRolloverActive) {
            rolloverCloudTarget = "protected";
            if (input.predecessorClaimId === claimId) rolloverNamedLineage = true;
          }
          const rolloverLossPhase = rolloverOptions.loseCloudResponsePhase ||
            (rolloverOptions.loseCloudResponse ? "bound" : null);
          const loseRolloverResponse = preparedRolloverActive && rolloverLossPhase &&
            !rolloverCloudResponseLost;
          cloudPhase = loseRolloverResponse ? rolloverLossPhase : "bound";
          if (loseRolloverResponse) {
            rolloverCloudResponseLost = true;
            throw new Error("simulated rollover-cloud response loss");
          }
          return input.canonicalBaseSha === descendantBaseSha
            ? descendantSuccessor
            : activeSuccessor();
        } }),
        bindActiveCloudSuccessor: input => {
          calls.bind.push(input);
          if (preparedRolloverActive) rolloverCloudTarget = "protected";
          cloudPhase = "bound";
          return activeSuccessor();
        },
        verifyActiveCloudSuccessor: input => {
          calls.verify.push(input);
          return activeSuccessor();
        },
        inspectCloudStatus: input => {
          const ledgerDigestOverride = preparedRolloverActive && v2IntentIsDurable()
            ? rolloverOptions.ledgerDigestAfterV2Cas
            : null;
          const observedStatus = claims => cloudStatus(claims, ledgerDigestOverride);
          const status = ({
            predecessor: observedStatus([activeRound === 1 || preparedRolloverActive
              ? activePredecessor() : liveSuccessor]),
            waiting: observedStatus(derivativeFault === "ambiguous"
              ? [waitingSuccessor, { ...waitingSuccessor, claimId: "0".repeat(64) }]
              : preparedRolloverActive && rolloverCloudTarget === "protected"
                ? [activePredecessor(), rolloverWaitingProjection()]
                : [{
                  ...waitingSuccessor,
                  laneRevision: derivativeFault === "head-unbound"
                    ? successorHeadSha : waitingSuccessor.laneRevision,
                  leaseEpoch: derivativeFault === "wrong-epoch" ? 3 : waitingSuccessor.leaseEpoch,
                }]),
            "current-base": observedStatus(
              preparedRolloverActive && rolloverCloudTarget === "protected"
                ? [
                  ...(rolloverOptions.protectedDerivativeRetainsSource
                    ? [activePredecessor()] : []),
                  rolloverCurrentProjection(),
                ]
                : [currentBaseSuccessor],
            ),
            bound: observedStatus(
              preparedRolloverActive && rolloverCloudTarget === "descendant"
                ? [descendantLiveSuccessor]
                : preparedRolloverActive && rolloverCloudTarget === "protected"
                  ? [
                    ...(rolloverOptions.protectedDerivativeRetainsSource
                      ? [activePredecessor()] : []),
                    rolloverBoundProjection(),
                  ]
                  : [activeRound === 1 ? liveSuccessor : secondLiveSuccessor],
            ),
          })[cloudPhase];
          calls.status.push({
            cloudPhase,
            rolloverCloudTarget,
            ledgerDigest: status.ledgerDigest,
            claims: status.claims,
            environment: input?.environment,
          });
          return status;
        },
        invokeCloudSuccessor: input => {
          calls.invoke.push(input);
          if (activeRolloverClaimReplay && input?.action === "claim") {
            const namedReplay = input.request.predecessorClaimId === claimId;
            if (rolloverOptions.rolloverClaimReplayWrongParent ||
                namedReplay !== rolloverNamedLineage) {
              const stale = "Cloud collaboration claim failed: expectedLedgerDigest is stale";
              throw new Error(rolloverOptions.doublePrefixClaimReplayStale
                ? `Cloud collaboration claim failed: ${stale}`
                : stale);
            }
            const claim = {
              ...rolloverWaitingProjection(),
              ...(rolloverOptions.rolloverClaimReplayOwnerOverrides || {}),
            };
            return {
              schema: "agentic-cloud-collaboration-result/v1",
              ok: true,
              action: "claim",
              status: "waiting-successor",
              replayed: true,
              claim,
              claimDigest: claim.fenceRevision,
            };
          }
          if (activeRolloverClaimReplay && input?.action === "retire") {
            if (rolloverOptions.rolloverSourceRetirementDrift) {
              throw new Error(
                "Cloud collaboration retire failed: expectedFenceRevision is stale",
              );
            }
            return {
              schema: "agentic-cloud-collaboration-result/v1",
              ok: true,
              action: "retire",
              status: "retired",
              replayed: true,
              claim: rolloverRetiredSource,
              claimDigest: rolloverRetiredSource.fenceRevision,
            };
          }
          if (!crashInjected && crashPhase === "after-intent" && !preparedRolloverActive) {
            crashInjected = true;
            throw new Error("simulated after-intent response loss");
          }
          if (providerLedgerDrift && preparedRolloverActive && input?.action === "claim") {
            throw new Error("Cloud collaboration claim failed: expectedLedgerDigest is stale");
          }
          if (providerEpochDemand && input?.action === "claim") {
            throw new Error(`leaseEpoch must be ${providerEpochDemand}`);
          }
          throw new Error("fake successor must own cloud invocation");
        },
        verifyCloudSuccessor: () => { throw new Error("fake successor must own cloud verification"); },
        casActiveLeaseProjection: input => {
          calls.cas.push(input);
          calls.timeline.push({
            kind: "cas",
            intentSchema: input.values.activePublishSuccessorIntent?.schema || null,
          });
          assert.equal(digestValue(lease), input.expectedLeaseDigest);
          assert.equal(lease.cloudAuthority.claimId, input.expectedClaimId);
          if (leaseStore) {
            const projected = casWriterLeaseProjection(input);
            lease = projected.lease;
            if (preparedRolloverActive &&
                input.values.activePublishSuccessorIntent?.schema ===
                  "agentic-active-publish-successor-intent/v2") {
              if (rolloverOptions.postCasDrift === "local-head") headSha = secondHeadSha;
              if (rolloverOptions.postCasDrift === "remote-head") remoteHeadSha = secondHeadSha;
              if (rolloverOptions.postCasDrift === "pull-request-head") {
                pullRequestHeadSha = secondHeadSha;
              }
              if (rolloverOptions.postCasDrift === "pull-request-id") pullRequestId = "PR_DRIFT";
              if (rolloverOptions.postCasDrift === "protected-base") {
                canonicalHeadSha = postCasProtectedBaseSha;
              }
              if (rolloverOptions.postCasDrift === "pull-request-base") {
                pullRequestBaseSha = intermediateBaseSha;
              }
              if (rolloverOptions.pullRequestBaseAfterV2Cas) {
                pullRequestBaseSha = preparedPullRequestBase(
                  rolloverOptions.pullRequestBaseAfterV2Cas,
                );
              }
              if (rolloverOptions.postCasCloudPhase) {
                cloudPhase = rolloverOptions.postCasCloudPhase;
                rolloverCloudTarget = "historical";
              }
              if (rolloverOptions.legacyProtectedDerivativeAfterV2Cas) {
                cloudPhase = rolloverOptions.legacyProtectedDerivativeAfterV2Cas;
                rolloverCloudTarget = "protected";
                rolloverNamedLineage = false;
              }
              if (rolloverOptions.loseCasResponse && !rolloverCasResponseLost) {
                rolloverCasResponseLost = true;
                throw new Error("simulated rollover-cas response loss");
              }
            }
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
        ...integrationOptions,
        log: () => {},
      });
    },
  };
  return fixture;
}

function deliveryDigests(value) {
  return Object.fromEntries(Object.keys(deliveryEvidence).map(key => [key, value[key]]));
}

function assertExactRolloverSourceRetirement({ fixture, retirement, label }) {
  const waiting = fixture.rolloverWaitingClaim;
  const successionEvidence = {
    schema: "agentic-legacy-review-successor-promotion/v1",
    branch,
    predecessorClaimId: fixture.sourceAuthority.claimId,
    successorClaimId: waiting.claimId,
    canonicalBaseSha: fixture.rolloverBaseSha,
    manifestDigest: fixture.sourceAdmission.manifestDigest,
    writeSetDigest: fixture.sourceAdmission.writeSetDigest,
  };
  assert.equal(retirement.action, "retire", label);
  assert.equal(retirement.request.claimId, fixture.sourceAuthority.claimId, label);
  assert.equal(retirement.request.expectedFenceRevision,
    fixture.sourceAuthority.claimDigest, label);
  assert.equal(retirement.request.expectedTransitionCounter,
    fixture.sourceAuthority.transitionCounter, label);
  assert.equal(retirement.request.expectedLedgerDigest, undefined, label);
  assert.equal(retirement.request.reason, "superseded", label);
  assert.equal(retirement.request.finalRevision, fixture.sourceAuthority.laneRevision, label);
  assert.equal(retirement.request.reviewRequestId,
    fixture.sourceAuthority.reviewRequestId, label);
  assert.equal(retirement.request.bytesDigest,
    digestValue({ ...successionEvidence, operation: "retire-bytes" }), label);
  assert.equal(retirement.request.namedChecksDigest,
    digestValue({ ...successionEvidence, operation: "retire-checks" }), label);
  assert.equal(retirement.request.handoffEvidenceDigest,
    digestValue({ ...successionEvidence, operation: "retire-handoff" }), label);
  assert.equal(retirement.request.idempotencyKey, [
    "legacy-review-supersede",
    fixture.sourceAuthority.claimId,
    waiting.claimId,
    waiting.fenceRevision,
  ].join(":"), label);
}

function cloudMutationResult({ action, claim, replayed }) {
  return {
    schema: "agentic-cloud-collaboration-result/v1",
    ok: true,
    action,
    status: claim.state,
    replayed,
    claim,
    claimDigest: claim.fenceRevision,
  };
}

function canonicalWorktree(repo, canonicalDirectory = "agentic-canvas-os") {
  return `worktree ${path.join(repo, "canonical", canonicalDirectory)}\0HEAD ${baseSha}\0branch refs/heads/main\0\0` +
    `worktree ${repo}\0HEAD ${fenceSha}\0branch refs/heads/${branch}\0\0`;
}
