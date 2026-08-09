import test from "node:test";
import assert from "node:assert/strict";

import { digestValue } from "../scripts/cloud-collaboration-primitives.mjs";
import {
  assertProtectedMainPathEquivalence,
  assertProtectedMainSharedAncestorPathEquivalence,
  captureProtectedMainPathEquivalence,
  captureProtectedMainSharedAncestorPathEquivalence,
  fetchProtectedMain,
  normalizeProtectedMainPathEquivalenceEvidence,
  normalizeProtectedMainSharedAncestorPathEquivalenceEvidence,
  readTreeBlobEntry,
} from "../scripts/protected-main-path-equivalence-lib.mjs";

const baseSha = "a".repeat(40);
const headSha = "b".repeat(40);
const headTreeSha = "c".repeat(40);
const protectedMainSha = "d".repeat(40);
const protectedMainTreeSha = "e".repeat(40);
const sharedAncestorSha = "f".repeat(40);
const sharedAncestorTreeSha = "0".repeat(40);
const relativePath = "docs/protected.md";
const blobSha = "1".repeat(40);

test("captures exact protected-main mode and blob evidence without requiring main below HEAD", () => {
  const { gitText, commands } = gitHarness();
  const evidence = captureProtectedMainPathEquivalence({
    baseSha,
    headSha,
    exemptPaths: [relativePath],
    gitText,
  });

  assert.deepEqual(evidence, {
    schema: "agentic-protected-main-path-equivalence/v1",
    baseSha,
    headSha,
    headTreeSha,
    protectedMainRef: "refs/remotes/origin/main",
    protectedMainSha,
    protectedMainTreeSha,
    exemptPathCount: 1,
    exemptPathsDigest: digestValue([relativePath]),
    entries: [{
      path: relativePath,
      headMode: "100644",
      headBlobSha: blobSha,
      protectedMode: "100644",
      protectedBlobSha: blobSha,
    }],
  });
  assert.ok(commands().includes(
    `merge-base --is-ancestor ${baseSha} ${protectedMainSha}`,
  ));
  assert.equal(
    commands().includes(
      `merge-base --is-ancestor ${protectedMainSha} ${headSha}`,
    ),
    false,
  );
});

test("captures published-prefix equivalence against one exact protected shared ancestor", () => {
  const { gitText, commands } = sharedAncestorGitHarness();
  const evidence = captureProtectedMainSharedAncestorPathEquivalence({
    baseSha,
    headSha,
    exemptPaths: [relativePath],
    gitText,
  });

  assert.deepEqual(evidence, {
    schema: "agentic-protected-main-shared-ancestor-path-equivalence/v1",
    baseSha,
    headSha,
    headTreeSha,
    protectedMainRef: "refs/remotes/origin/main",
    protectedMainSha,
    protectedMainTreeSha,
    sharedAncestorSha,
    sharedAncestorTreeSha,
    exemptPathCount: 1,
    exemptPathsDigest: digestValue([relativePath]),
    entries: [{
      path: relativePath,
      headMode: "100644",
      headBlobSha: blobSha,
      sharedAncestorMode: "100644",
      sharedAncestorBlobSha: blobSha,
    }],
  });
  assert.ok(commands().includes(
    `merge-base --all ${headSha} ${protectedMainSha}`,
  ));
  assert.ok(commands().includes(
    `merge-base --is-ancestor ${baseSha} ${sharedAncestorSha}`,
  ));
  assert.ok(commands().includes(
    `merge-base --is-ancestor ${sharedAncestorSha} ${protectedMainSha}`,
  ));
  assert.ok(commands().includes(
    `merge-base --is-ancestor ${sharedAncestorSha} ${headSha}`,
  ));
});

test("shared-ancestor equivalence rejects ambiguous ancestry and noncanonical bytes", () => {
  assert.throws(() => captureProtectedMainSharedAncestorPathEquivalence({
    baseSha,
    headSha,
    exemptPaths: [relativePath],
    gitText: sharedAncestorGitHarness({ mergeBases: [] }).gitText,
  }), /exactly one shared ancestor/);
  assert.throws(() => captureProtectedMainSharedAncestorPathEquivalence({
    baseSha,
    headSha,
    exemptPaths: [relativePath],
    gitText: sharedAncestorGitHarness({
      mergeBases: [sharedAncestorSha, "9".repeat(40)],
    }).gitText,
  }), /exactly one shared ancestor/);
  for (const option of [
    { baseAncestryError: true },
    { mainAncestryError: true },
    { headAncestryError: true },
  ]) {
    assert.throws(() => captureProtectedMainSharedAncestorPathEquivalence({
      baseSha,
      headSha,
      exemptPaths: [relativePath],
      gitText: sharedAncestorGitHarness(option).gitText,
    }), /not an ancestor/);
  }
  assert.throws(() => captureProtectedMainSharedAncestorPathEquivalence({
    baseSha,
    headSha,
    exemptPaths: [relativePath],
    gitText: sharedAncestorGitHarness({
      headBlobSha: "2".repeat(40),
    }).gitText,
  }), /differs from its protected-main shared ancestor/);
});

test("shared-ancestor evidence revalidation binds merge-base, trees, and entries", () => {
  const evidence = captureProtectedMainSharedAncestorPathEquivalence({
    baseSha,
    headSha,
    exemptPaths: [relativePath],
    gitText: sharedAncestorGitHarness().gitText,
  });
  assert.throws(() => assertProtectedMainSharedAncestorPathEquivalence({
    evidence,
    baseSha,
    headSha,
    exemptPaths: [relativePath],
    gitText: sharedAncestorGitHarness({
      sharedAncestorTreeSha: "7".repeat(40),
    }).gitText,
  }), /evidence drifted/);
  assert.throws(() => captureProtectedMainSharedAncestorPathEquivalence({
    baseSha,
    headSha,
    exemptPaths: [relativePath],
    gitText: sharedAncestorGitHarness({
      finalSharedAncestorTreeSha: "8".repeat(40),
    }).gitText,
  }), /ref, merge-base, or tree drifted/);
  assert.throws(() =>
    normalizeProtectedMainSharedAncestorPathEquivalenceEvidence({
      ...evidence,
      sharedAncestorTreeSha: undefined,
    }), /malformed/);
  assert.throws(() =>
    normalizeProtectedMainSharedAncestorPathEquivalenceEvidence({
      ...evidence,
      entries: [{
        ...evidence.entries[0],
        sharedAncestorBlobSha: "9".repeat(40),
      }],
    }), /malformed/);
});

test("fetches only the exact protected-main remote-tracking ref", () => {
  const calls = [];
  fetchProtectedMain({ run: (command, args) => calls.push([command, ...args]) });
  assert.deepEqual(calls, [[
    "git",
    "fetch",
    "--no-tags",
    "origin",
    "+refs/heads/main:refs/remotes/origin/main",
  ]]);
});

test("shared tree reader preserves canonical Git paths outside recovery policy", () => {
  const gitPath = String.raw`docs/path\with-backslash.md`;
  const entry = readTreeBlobEntry({
    gitText: args => `100644 blob ${blobSha}\t${args[4]}\0`,
    treeish: headSha,
    relativePath: gitPath,
    label: "Canonical target",
  });
  assert.deepEqual(entry, { mode: "100644", blobSha });
});

test("rejects non-equivalent mode and blob subjects", () => {
  assert.throws(() => captureProtectedMainPathEquivalence({
    baseSha,
    headSha,
    exemptPaths: [relativePath],
    gitText: gitHarness({ headMode: "100755" }).gitText,
  }), /differs from fetched protected main/);
  assert.throws(() => captureProtectedMainPathEquivalence({
    baseSha,
    headSha,
    exemptPaths: [relativePath],
    gitText: gitHarness({ headBlobSha: "2".repeat(40) }).gitText,
  }), /differs from fetched protected main/);
});

test("rejects missing paths, non-blobs, and unsupported blob modes", () => {
  assert.throws(() => captureProtectedMainPathEquivalence({
    baseSha,
    headSha,
    exemptPaths: [relativePath],
    gitText: gitHarness({ missingHead: true }).gitText,
  }), /does not contain exactly one tracked blob/);
  assert.throws(() => captureProtectedMainPathEquivalence({
    baseSha,
    headSha,
    exemptPaths: [relativePath],
    gitText: gitHarness({ protectedType: "commit" }).gitText,
  }), /does not contain tracked blob/);
  assert.throws(() => captureProtectedMainPathEquivalence({
    baseSha,
    headSha,
    exemptPaths: [relativePath],
    gitText: gitHarness({ headMode: "100664", protectedMode: "100664" }).gitText,
  }), /does not contain tracked blob/);
});

test("rejects source-base ancestry failure", () => {
  assert.throws(() => captureProtectedMainPathEquivalence({
    baseSha,
    headSha,
    exemptPaths: [relativePath],
    gitText: gitHarness({ baseAncestryError: true }).gitText,
  }), /base is not an ancestor/);
});

test("rejects HEAD, protected ref, and protected tree TOCTOU drift", () => {
  assert.throws(() => captureProtectedMainPathEquivalence({
    baseSha,
    headSha,
    exemptPaths: [relativePath],
    gitText: gitHarness({ finalHeadSha: "3".repeat(40) }).gitText,
  }), /ref or tree drifted/);
  assert.throws(() => captureProtectedMainPathEquivalence({
    baseSha,
    headSha,
    exemptPaths: [relativePath],
    gitText: gitHarness({ finalProtectedMainSha: "4".repeat(40) }).gitText,
  }), /ref or tree drifted/);
  assert.throws(() => captureProtectedMainPathEquivalence({
    baseSha,
    headSha,
    exemptPaths: [relativePath],
    gitText: gitHarness({ finalProtectedMainTreeSha: "5".repeat(40) }).gitText,
  }), /ref or tree drifted/);
});

test("revalidation rejects stable ref, tree, mode, or blob evidence drift", () => {
  const evidence = captureProtectedMainPathEquivalence({
    baseSha,
    headSha,
    exemptPaths: [relativePath],
    gitText: gitHarness().gitText,
  });
  assert.throws(() => assertProtectedMainPathEquivalence({
    evidence,
    baseSha,
    headSha,
    exemptPaths: [relativePath],
    gitText: gitHarness({
      headBlobSha: "6".repeat(40),
      protectedBlobSha: "6".repeat(40),
    }).gitText,
  }), /evidence drifted/);
  assert.throws(() => assertProtectedMainPathEquivalence({
    evidence,
    baseSha,
    headSha,
    exemptPaths: [relativePath],
    gitText: gitHarness({
      protectedMainTreeSha: "7".repeat(40),
    }).gitText,
  }), /evidence drifted/);
});

test("normalizer rejects extra fields and nested equality drift", () => {
  const evidence = captureProtectedMainPathEquivalence({
    baseSha,
    headSha,
    exemptPaths: [relativePath],
    gitText: gitHarness().gitText,
  });
  assert.throws(() => normalizeProtectedMainPathEquivalenceEvidence({
    ...evidence,
    unbound: true,
  }), /malformed/);
  assert.throws(() => normalizeProtectedMainPathEquivalenceEvidence({
    ...evidence,
    entries: [{
      ...evidence.entries[0],
      protectedBlobSha: "8".repeat(40),
    }],
  }), /malformed/);
});

function gitHarness({
  headMode = "100644",
  protectedMode = "100644",
  headBlobSha = blobSha,
  protectedBlobSha = blobSha,
  headType = "blob",
  protectedType = "blob",
  missingHead = false,
  missingProtected = false,
  baseAncestryError = false,
  finalHeadSha = headSha,
  finalProtectedMainSha = protectedMainSha,
  finalHeadTreeSha = headTreeSha,
  finalProtectedMainTreeSha = null,
  protectedMainTreeSha: observedProtectedMainTreeSha = protectedMainTreeSha,
} = {}) {
  const observed = [];
  let headReads = 0;
  let headTreeReads = 0;
  let protectedReads = 0;
  let protectedTreeReads = 0;
  return {
    commands: () => observed,
    gitText: args => {
      const key = args.join(" ");
      observed.push(key);
      if (key === "rev-parse HEAD") {
        headReads += 1;
        return headReads === 1 ? headSha : finalHeadSha;
      }
      if (key === `rev-parse ${headSha}^{tree}`) {
        headTreeReads += 1;
        return headTreeReads === 1 ? headTreeSha : finalHeadTreeSha;
      }
      if (key === "rev-parse refs/remotes/origin/main") {
        protectedReads += 1;
        return protectedReads === 1
          ? protectedMainSha
          : finalProtectedMainSha;
      }
      if (key === `merge-base --is-ancestor ${baseSha} ${protectedMainSha}`) {
        if (baseAncestryError) {
          throw new Error("fatal: base is not an ancestor");
        }
        return "";
      }
      if (key === `rev-parse ${protectedMainSha}^{tree}`) {
        protectedTreeReads += 1;
        return protectedTreeReads === 1
          ? observedProtectedMainTreeSha
          : finalProtectedMainTreeSha || observedProtectedMainTreeSha;
      }
      if (args[0] === "ls-tree" && args[1] === "-z") {
        const treeish = args[2];
        const path = args[4];
        if (treeish === headSha) {
          return missingHead
            ? ""
            : `${headMode} ${headType} ${headBlobSha}\t${path}\0`;
        }
        if (treeish === protectedMainSha) {
          return missingProtected
            ? ""
            : `${protectedMode} ${protectedType} ${protectedBlobSha}\t${path}\0`;
        }
      }
      throw new Error(`unexpected git command: ${key}`);
    },
  };
}

function sharedAncestorGitHarness({
  headMode = "100644",
  sharedAncestorMode = "100644",
  headBlobSha = blobSha,
  sharedAncestorBlobSha = blobSha,
  headType = "blob",
  sharedAncestorType = "blob",
  missingHead = false,
  missingSharedAncestor = false,
  mergeBases = [sharedAncestorSha],
  finalMergeBases = mergeBases,
  baseAncestryError = false,
  mainAncestryError = false,
  headAncestryError = false,
  finalHeadSha = headSha,
  finalHeadTreeSha = headTreeSha,
  finalProtectedMainSha = protectedMainSha,
  finalProtectedMainTreeSha = protectedMainTreeSha,
  protectedMainTreeSha: observedProtectedMainTreeSha = protectedMainTreeSha,
  sharedAncestorTreeSha: observedSharedAncestorTreeSha =
    sharedAncestorTreeSha,
  finalSharedAncestorTreeSha = observedSharedAncestorTreeSha,
} = {}) {
  const observed = [];
  let worktreeHeadReads = 0;
  let headTreeReads = 0;
  let protectedMainReads = 0;
  let protectedMainTreeReads = 0;
  let mergeBaseReads = 0;
  let sharedAncestorTreeReads = 0;
  return {
    commands: () => observed,
    gitText: args => {
      const key = args.join(" ");
      observed.push(key);
      if (key === "rev-parse HEAD") {
        worktreeHeadReads += 1;
        return worktreeHeadReads === 1 ? headSha : finalHeadSha;
      }
      if (key === `rev-parse ${headSha}^{tree}`) {
        headTreeReads += 1;
        return headTreeReads === 1 ? headTreeSha : finalHeadTreeSha;
      }
      if (key === "rev-parse refs/remotes/origin/main") {
        protectedMainReads += 1;
        return protectedMainReads === 1
          ? protectedMainSha
          : finalProtectedMainSha;
      }
      if (key === `merge-base --all ${headSha} ${protectedMainSha}`) {
        mergeBaseReads += 1;
        return (mergeBaseReads === 1 ? mergeBases : finalMergeBases)
          .join("\n");
      }
      if (key ===
        `merge-base --is-ancestor ${baseSha} ${sharedAncestorSha}`) {
        if (baseAncestryError) throw new Error("base is not an ancestor");
        return "";
      }
      if (key ===
        `merge-base --is-ancestor ${sharedAncestorSha} ${protectedMainSha}`) {
        if (mainAncestryError) throw new Error("shared is not an ancestor");
        return "";
      }
      if (key ===
        `merge-base --is-ancestor ${sharedAncestorSha} ${headSha}`) {
        if (headAncestryError) throw new Error("shared is not an ancestor");
        return "";
      }
      if (key === `rev-parse ${protectedMainSha}^{tree}`) {
        protectedMainTreeReads += 1;
        return protectedMainTreeReads === 1
          ? observedProtectedMainTreeSha
          : finalProtectedMainTreeSha;
      }
      if (key === `rev-parse ${sharedAncestorSha}^{tree}`) {
        sharedAncestorTreeReads += 1;
        return sharedAncestorTreeReads === 1
          ? observedSharedAncestorTreeSha
          : finalSharedAncestorTreeSha;
      }
      if (args[0] === "ls-tree" && args[1] === "-z") {
        const treeish = args[2];
        const path = args[4];
        if (treeish === headSha) {
          return missingHead
            ? ""
            : `${headMode} ${headType} ${headBlobSha}\t${path}\0`;
        }
        if (treeish === sharedAncestorSha) {
          return missingSharedAncestor
            ? ""
            : `${sharedAncestorMode} ${sharedAncestorType} ${sharedAncestorBlobSha}\t${path}\0`;
        }
      }
      throw new Error(`unexpected git command: ${key}`);
    },
  };
}
