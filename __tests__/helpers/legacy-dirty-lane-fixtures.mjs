import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  captureLegacyDirtyLane,
  MERGED_PULL_REQUEST_EVIDENCE_SCHEMA,
} from "../../scripts/legacy-dirty-lane-adoption-lib.mjs";
import { createWriterLeaseStore } from "../../scripts/writer-lease-lib.mjs";
import { writerLeaseDigest } from "../../scripts/writer-lease-registry-cas.mjs";

export function capturedFixture() {
  const fixture = createFixture();
  captureLegacyDirtyLane({
    sourceWorktree: fixture.source,
    recoveryDirectory: fixture.recovery,
    protectedTipSha: fixture.baseSha,
    operatorSessionId: "session-a",
  });
  return fixture;
}

export function createFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "legacy-adoption-"));
  const repository = path.join(root, "repository");
  const source = path.join(root, "source");
  const recovery = path.join(root, "recovery");
  mkdirSync(repository);
  git(repository, ["init", "-b", "main"]);
  configureUser(repository);
  writeFileSync(path.join(repository, "tracked.txt"), "base\n");
  git(repository, ["add", "tracked.txt"]);
  git(repository, ["commit", "-m", "base"]);
  const baseSha = git(repository, ["rev-parse", "HEAD"]).trim();
  git(repository, ["worktree", "add", "-b", "agent/test/legacy-payments", source, baseSha]);
  writeFileSync(path.join(source, "tracked.txt"), "changed\n");
  writeFileSync(path.join(source, "new.txt"), "untracked\n");
  return { root, repository, source, recovery, baseSha };
}

export function createCanonicalRetentionFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "canonical-retention-"));
  const remote = path.join(root, "remote.git");
  const source = path.join(root, "source");
  const recovery = path.join(root, "recovery");
  git(root, ["init", "--bare", remote]);
  git(root, ["clone", remote, source]);
  configureUser(source);
  git(source, ["switch", "-c", "main"]);
  writeFileSync(path.join(source, "tracked.txt"), "base\n");
  git(source, ["add", "tracked.txt"]);
  git(source, ["commit", "-m", "base"]);
  git(source, ["push", "-u", "origin", "main"]);
  const protectedTip = git(source, ["rev-parse", "HEAD"]).trim();
  mkdirSync(path.join(source, "retained"));
  writeFileSync(path.join(source, "retained/doc.md"), "retain me\n");
  return { root, remote, source, recovery, protectedTip };
}

export function createSquashIntegratedFixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), "squash-integrated-adoption-"));
  const remote = path.join(root, "remote.git");
  const repository = path.join(root, "repository");
  const source = path.join(root, "source");
  const recovery = path.join(root, "recovery");
  git(root, ["init", "--bare", remote]);
  git(root, ["clone", remote, repository]);
  configureUser(repository);
  git(repository, ["switch", "-c", "main"]);
  writeFileSync(path.join(repository, ".DS_Store"), "protected\n");
  writeFileSync(path.join(repository, "committed.txt"), "base\n");
  git(repository, ["add", "-f", ".DS_Store", "committed.txt"]);
  git(repository, ["commit", "-m", "base"]);
  git(repository, ["push", "-u", "origin", "main"]);
  const baseSha = git(repository, ["rev-parse", "HEAD"]).trim();
  const baseTreeSha = git(repository, ["rev-parse", "HEAD^{tree}"]).trim();
  const sourceBranch = "agent/test/canonical-branch-state-glossary";
  git(repository, ["worktree", "add", "-b", sourceBranch, source, baseSha]);
  writeFileSync(path.join(source, "committed.txt"), "merged\n");
  git(source, ["add", "committed.txt"]);
  git(source, ["commit", "-m", "source head"]);
  const sourceHeadSha = git(source, ["rev-parse", "HEAD"]).trim();
  const sourceTreeSha = git(source, ["rev-parse", "HEAD^{tree}"]).trim();
  const mergeCommitSha = git(repository, [
    "commit-tree", sourceTreeSha, "-p", baseSha, "-m", "squash merge",
  ]).trim();
  const protectedTip = git(repository, [
    "commit-tree", sourceTreeSha, "-p", mergeCommitSha, "-m", "protected descendant",
  ]).trim();
  const topologyLieCommitSha = git(repository, [
    "commit-tree", sourceTreeSha, "-p", baseSha, "-m", "topology lie",
  ]).trim();
  git(repository, ["push", "origin", `${protectedTip}:refs/heads/main`]);
  git(source, ["update-ref", "refs/remotes/origin/main", baseSha]);
  writeFileSync(path.join(source, ".DS_Store"), "local residue\n");
  mkdirSync(path.join(source, "docs/documents"), { recursive: true });
  writeFileSync(
    path.join(source, "docs/documents/agentic-game-os-prd-tad-adr.md"),
    "# Agentic Game OS\n",
  );
  return {
    root,
    repository,
    source,
    recovery,
    baseSha,
    baseTreeSha,
    mergeCommitSha,
    protectedTip,
    topologyLieCommitSha,
    pullRequestEvidence: {
      schema: MERGED_PULL_REQUEST_EVIDENCE_SCHEMA,
      repository: "test/repository",
      pullRequestNumber: 96,
      state: "closed",
      draft: false,
      merged: true,
      mergedAt: "2026-08-04T01:40:48Z",
      mergeCommitSha,
      headRepository: "test/repository",
      headBranch: sourceBranch,
      headSha: sourceHeadSha,
      baseRepository: "test/repository",
      baseBranch: "main",
      baseSha,
    },
  };
}

export function addTarget(fixture, scope, startSha = fixture.protectedTip || fixture.baseSha) {
  const target = path.join(fixture.root, scope);
  git(fixture.repository, [
    "worktree", "add", "-b", `agent/test/${scope}`, target, startSha,
  ]);
  return target;
}

export function createTargetLease({
  target,
  baseSha,
  sessionId,
  clock = { value: Date.parse("2026-08-08T00:00:00.000Z") },
}) {
  const branch = git(target, ["branch", "--show-current"]).trim();
  const scope = branch.split("/").at(-1);
  const commonDirectory = path.resolve(
    target,
    git(target, ["rev-parse", "--git-common-dir"]).trim(),
  );
  const leaseStore = createWriterLeaseStore({
    gitCommonDir: commonDirectory,
    now: () => new Date(clock.value),
  });
  leaseStore.claim({
    sessionId,
    device: "test",
    scope,
    branch,
    worktreePath: target,
    baseSha,
    ttlMs: 60_000,
  });
  const lease = leaseStore.annotate({
    sessionId,
    branch,
    values: { fenceSha: git(target, ["rev-parse", "HEAD"]).trim() },
  });
  const expectedLeaseDigest = writerLeaseDigest(lease);
  return {
    lease,
    leaseStore,
    expectedLeaseDigest,
    adoption: {
      leaseStore,
      expectedLeaseDigest,
      now: () => new Date(clock.value),
    },
  };
}

export function readManifest(recovery) {
  return JSON.parse(readFileSync(path.join(recovery, "manifest.json"), "utf8"));
}

export function rewriteManifest(recovery, original, mutate) {
  const manifest = structuredClone(original);
  mutate(manifest);
  if (manifest.squashIntegrationProof) {
    const { proofDigest: _proofDigest, ...proofCore } = manifest.squashIntegrationProof;
    manifest.squashIntegrationProof.proofDigest = digest(JSON.stringify(proofCore));
  }
  const { packageDigest: _packageDigest, ...core } = manifest;
  manifest.packageDigest = digest(JSON.stringify(core));
  writeFileSync(path.join(recovery, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  writeFileSync(path.join(recovery, ".complete"), `${manifest.packageDigest}\n`);
}

export function sourceSnapshot(worktree) {
  return {
    status: status(worktree),
    refs: refSnapshot(worktree),
    objects: git(worktree, ["count-objects", "-v"]),
  };
}

export function refSnapshot(worktree) {
  return git(worktree, ["for-each-ref", "--format=%(refname) %(objectname)"]);
}

export function configureUser(worktree) {
  git(worktree, ["config", "user.email", "test@example.com"]);
  git(worktree, ["config", "user.name", "Test"]);
}

export function status(worktree) {
  return git(worktree, ["status", "--porcelain=v1", "--untracked-files=all"]);
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function git(worktree, args) {
  return execFileSync("git", args, { cwd: worktree, encoding: "utf8" });
}
