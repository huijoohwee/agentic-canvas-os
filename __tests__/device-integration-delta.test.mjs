import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  captureCommittedIntegrationDelta,
  captureStagedIntegrationDelta,
  DEVICE_INTEGRATION_DELTA_SCHEMA,
  listIntegrationWorkingTreePaths,
  projectLegacyIntegrationPaths,
  sealCommittedIntegrationDelta,
} from "../scripts/device-integration-delta.mjs";
import {
  deriveLegacyReviewAdmissionManifest,
} from "../scripts/device-branch-lib.mjs";
import {
  createRepositoryValidationEvidence,
  rememberRepositoryValidationEvidenceForInvocation,
  reusableRepositoryValidationEvidence,
  verifyRepositoryValidationEvidence,
} from "../scripts/device-delivery-evidence.mjs";

test("canonical delta extraction represents a rename as delete plus add", () => {
  const fixture = createRepository({ "old-name.txt": "original\n" });
  const commands = [];
  try {
    renameSync(
      path.join(fixture.root, "old-name.txt"),
      path.join(fixture.root, "new-name.txt"),
    );
    const gitText = args => {
      commands.push(args);
      return git(fixture.root, args);
    };
    assert.deepEqual(listIntegrationWorkingTreePaths({ gitText }), [
      "new-name.txt",
      "old-name.txt",
    ]);

    git(fixture.root, ["add", "-A"]);
    const staged = captureStagedIntegrationDelta({
      gitText,
      parentSha: fixture.baseSha,
      approvedPaths: ["new-name.txt", "old-name.txt"],
      admission: admission(["new-name.txt", "old-name.txt"]),
    });
    assert.equal(staged.schema, DEVICE_INTEGRATION_DELTA_SCHEMA);
    assert.match(staged.treeSha, /^[0-9a-f]{40}$/u);
    assert.match(staged.structuralDeltaDigest, /^[0-9a-f]{64}$/u);
    assert.deepEqual(staged.paths, ["new-name.txt", "old-name.txt"]);

    git(fixture.root, ["commit", "-m", "rename exact path"]);
    const sealed = sealCommittedIntegrationDelta({
      gitText,
      stagedDelta: staged,
      admission: admission(["new-name.txt", "old-name.txt"]),
    });
    assert.equal(sealed.treeSha, staged.treeSha);
    assert.equal(sealed.structuralDeltaDigest, staged.structuralDeltaDigest);
    assert.equal(sealed.stagedDiffDigest, staged.stagedDiffDigest);
    assert.deepEqual(projectLegacyIntegrationPaths({
      gitText,
      parentSha: fixture.baseSha,
      headSha: sealed.commitSha,
    }), ["new-name.txt"]);
    assert.ok(commands.some(args => args.includes("--no-renames")));
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("legacy root-source review admission represents a rename as delete plus add", () => {
  const parentSha = "a".repeat(40);
  const headSha = "b".repeat(40);
  const commands = [];
  const manifest = deriveLegacyReviewAdmissionManifest({
    lease: { baseSha: parentSha, scope: "legacy-review", reviewHeadSha: headSha },
    canonicalBaseSha: parentSha,
    headSha,
    gitText: args => {
      commands.push(args);
      if (args[0] === "merge-base") return "";
      if (args[0] === "diff") return "new-name.txt\0old-name.txt\0";
      throw new Error(`unexpected git command: ${args.join(" ")}`);
    },
  });
  assert.deepEqual(manifest.declaredWriteSet, [
    "path:new-name.txt",
    "path:old-name.txt",
    "semantic:legacy-review",
  ]);
  assert.ok(commands.some(args => args.includes("--no-renames") && args.includes("-z")));
});

test("post-commit sealing rejects a pre-commit hook that changes staged bytes", () => {
  const fixture = createRepository({ "owned.txt": "base\n" });
  try {
    writeFileSync(path.join(fixture.root, "owned.txt"), "validated\n");
    git(fixture.root, ["add", "owned.txt"]);
    const gitText = args => git(fixture.root, args);
    const staged = captureStagedIntegrationDelta({
      gitText,
      parentSha: fixture.baseSha,
      approvedPaths: ["owned.txt"],
      admission: admission(["owned.txt"]),
    });
    const hookPath = path.join(fixture.root, ".git", "hooks", "pre-commit");
    writeFileSync(hookPath, [
      "#!/bin/sh",
      "printf 'hook-mutated\\n' > owned.txt",
      "git add -- owned.txt",
      "",
    ].join("\n"));
    chmodSync(hookPath, 0o755);

    git(fixture.root, ["commit", "-m", "hook mutation"]);
    assert.throws(() => sealCommittedIntegrationDelta({
      gitText,
      stagedDelta: staged,
      admission: admission(["owned.txt"]),
    }), /tree changed from the sealed staged tree/u);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("clean precommitted integration derives the complete fence-to-head delta", () => {
  const fixture = createRepository({ "base.txt": "base\n" });
  try {
    writeFileSync(path.join(fixture.root, "first.txt"), "first\n");
    writeFileSync(path.join(fixture.root, "second.txt"), "second\n");
    git(fixture.root, ["add", "first.txt", "second.txt"]);
    git(fixture.root, ["commit", "-m", "one authored change"]);
    const headSha = git(fixture.root, ["rev-parse", "HEAD"]).trim();

    const delta = captureCommittedIntegrationDelta({
      gitText: args => git(fixture.root, args),
      parentSha: fixture.baseSha,
      headSha,
      admission: admission(["first.txt", "second.txt"]),
    });
    assert.deepEqual(delta.paths, ["first.txt", "second.txt"]);
    assert.match(delta.stagedDiffDigest, /^[0-9a-f]{64}$/u);
    assert.match(delta.structuralDeltaDigest, /^[0-9a-f]{64}$/u);
    assert.equal(delta.treeSha, git(fixture.root, ["rev-parse", "HEAD^{tree}"]).trim());
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("clean precommitted integration rejects a multi-commit range that strict replay cannot seal", () => {
  const fixture = createRepository({ "base.txt": "base\n" });
  try {
    for (const name of ["first.txt", "second.txt"]) {
      writeFileSync(path.join(fixture.root, name), `${name}\n`);
      git(fixture.root, ["add", name]);
      git(fixture.root, ["commit", "-m", `add ${name}`]);
    }
    assert.throws(() => captureCommittedIntegrationDelta({
      gitText: args => git(fixture.root, args),
      parentSha: fixture.baseSha,
      headSha: git(fixture.root, ["rev-parse", "HEAD"]).trim(),
      admission: admission(["first.txt", "second.txt"]),
    }), /one exact commit whose only parent is the writer fence/u);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("integration delta capture rejects paths outside admitted ownership", () => {
  const fixture = createRepository({ "owned.txt": "base\n" });
  try {
    writeFileSync(path.join(fixture.root, "outside.txt"), "outside\n");
    git(fixture.root, ["add", "outside.txt"]);
    assert.throws(() => captureStagedIntegrationDelta({
      gitText: args => git(fixture.root, args),
      parentSha: fixture.baseSha,
      approvedPaths: ["outside.txt"],
      admission: admission(["owned.txt"]),
    }), /paths changed from the admitted write-set evidence/u);
  } finally {
    rmSync(fixture.root, { recursive: true, force: true });
  }
});

test("repository validation evidence is reusable exactly once by its invocation", () => {
  const fixture = validationEvidenceFixture();
  rememberRepositoryValidationEvidenceForInvocation({
    repository: fixture.identity.repository,
    gitText: fixture.gitText,
    evidence: fixture.evidence,
  });

  assert.deepEqual(reusableRepositoryValidationEvidence({
    ...fixture.identity,
    gitText: fixture.gitText,
    now: () => new Date("2026-08-30T00:05:00.000Z"),
  }), fixture.evidence);
  assert.equal(reusableRepositoryValidationEvidence({
    ...fixture.identity,
    gitText: fixture.gitText,
    now: () => new Date("2026-08-30T00:05:01.000Z"),
  }), null);
});

test("repository validation reuse rejects session, base, and freshness drift", () => {
  const cases = [
    { identity: { sessionId: "session-b" }, now: "2026-08-30T00:05:00.000Z" },
    { identity: { canonicalBaseSha: "0".repeat(40) }, now: "2026-08-30T00:05:00.000Z" },
    { identity: {}, now: "2026-08-30T00:10:00.001Z" },
  ];
  for (const candidate of cases) {
    const fixture = validationEvidenceFixture();
    rememberRepositoryValidationEvidenceForInvocation({
      repository: fixture.identity.repository,
      gitText: fixture.gitText,
      evidence: fixture.evidence,
    });
    assert.equal(reusableRepositoryValidationEvidence({
      ...fixture.identity,
      ...candidate.identity,
      gitText: fixture.gitText,
      now: () => new Date(candidate.now),
    }), null);
  }
});

test("repository validation reuse consumes HEAD drift and falls back to a fresh check", () => {
  const fixture = validationEvidenceFixture();
  const driftedGitText = args => args.join(" ") === "rev-parse HEAD"
    ? "0".repeat(40)
    : fixture.gitText(args);
  rememberRepositoryValidationEvidenceForInvocation({
    repository: fixture.identity.repository,
    gitText: driftedGitText,
    evidence: fixture.evidence,
  });
  const input = {
    ...fixture.identity,
    gitText: driftedGitText,
    now: () => new Date("2026-08-30T00:05:00.000Z"),
  };
  assert.equal(reusableRepositoryValidationEvidence(input), null);
  assert.equal(reusableRepositoryValidationEvidence(input), null);
});

test("repository validation reuse consumes origin/main drift and falls back to a fresh check", () => {
  const fixture = validationEvidenceFixture();
  const driftedGitText = args => args.join(" ") === "rev-parse origin/main"
    ? "0".repeat(40)
    : fixture.gitText(args);
  rememberRepositoryValidationEvidenceForInvocation({
    repository: fixture.identity.repository,
    gitText: driftedGitText,
    evidence: fixture.evidence,
  });
  assert.equal(reusableRepositoryValidationEvidence({
    ...fixture.identity,
    gitText: driftedGitText,
    now: () => new Date("2026-08-30T00:05:00.000Z"),
  }), null);
});

test("repository validation verification accepts canonical field reordering", () => {
  const fixture = validationEvidenceFixture();
  const reordered = Object.fromEntries(Object.entries(fixture.evidence).reverse());
  assert.deepEqual(verifyRepositoryValidationEvidence({
    ...fixture.identity,
    gitText: fixture.gitText,
    evidence: reordered,
  }), fixture.evidence);
});

test("repository validation reuse rejects a different guarded worktree", () => {
  const fixture = validationEvidenceFixture();
  rememberRepositoryValidationEvidenceForInvocation({
    repository: fixture.identity.repository,
    gitText: fixture.gitText,
    evidence: fixture.evidence,
  });
  assert.equal(reusableRepositoryValidationEvidence({
    ...fixture.identity,
    repository: "/workspace/another-integration-delta",
    gitText: fixture.gitText,
    now: () => new Date("2026-08-30T00:05:00.000Z"),
  }), null);
});

test("repository validation verification rejects a different final authority base", () => {
  const fixture = validationEvidenceFixture();
  assert.throws(() => verifyRepositoryValidationEvidence({
    ...fixture.identity,
    canonicalBaseSha: "0".repeat(40),
    gitText: fixture.gitText,
    evidence: fixture.evidence,
  }), /does not bind the delivered head and tree/u);
});

function createRepository(files) {
  const root = mkdtempSync(path.join(os.tmpdir(), "agentic-device-integration-delta-"));
  git(root, ["init", "--initial-branch=main"]);
  git(root, ["config", "user.name", "Agentic Integration Test"]);
  git(root, ["config", "user.email", "agentic-integration@example.test"]);
  mkdirSync(path.join(root, ".git", "hooks"), { recursive: true });
  for (const [relativePath, bytes] of Object.entries(files)) {
    writeFileSync(path.join(root, relativePath), bytes);
  }
  git(root, ["add", "-A"]);
  git(root, ["commit", "-m", "base"]);
  return { root, baseSha: git(root, ["rev-parse", "HEAD"]).trim() };
}

function admission(paths) {
  return {
    schema: "agentic-lane-admission-lease/v1",
    status: "admitted",
    semanticScope: "device-integration-delta",
    declaredWriteSet: [
      ...paths.map(relativePath => `path:${relativePath}`),
      "semantic:device-integration-delta",
    ].sort(),
  };
}

function validationEvidenceFixture() {
  const headSha = "a".repeat(40);
  const headTreeSha = "b".repeat(40);
  const targetMainSha = "c".repeat(40);
  const targetMainTreeSha = "d".repeat(40);
  const packageJsonBlobSha = "e".repeat(40);
  const packageLockBlobSha = "f".repeat(40);
  const identity = {
    repository: "/workspace/integration-delta",
    branch: "agent/device/integration-delta",
    sessionId: "session-a",
    leaseEpoch: 1,
    canonicalBaseSha: targetMainSha,
  };
  const gitText = args => {
    const key = args.join(" ");
    if (key === "rev-parse HEAD") return headSha;
    if (key === "rev-parse origin/main") return targetMainSha;
    if (key === `rev-parse ${headSha}^{tree}`) return headTreeSha;
    if (key === `rev-parse ${targetMainSha}^{tree}`) return targetMainTreeSha;
    if (key === `rev-parse ${headSha}:package.json`) return packageJsonBlobSha;
    if (key === `rev-parse ${headSha}:package-lock.json`) return packageLockBlobSha;
    throw new Error(`unexpected validation git command: ${key}`);
  };
  return {
    gitText,
    identity,
    evidence: createRepositoryValidationEvidence({
      gitText,
      headSha,
      targetMainSha,
      branch: identity.branch,
      sessionId: identity.sessionId,
      leaseEpoch: identity.leaseEpoch,
      validatedAt: "2026-08-30T00:00:00.000Z",
    }),
  };
}

function git(cwd, args) {
  return execFileSync("git", args, { cwd, encoding: "utf8" });
}
