import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const SHA_PATTERN = /^[0-9a-f]{40}$/u;
const LEDGER_REF_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9._/-]*[A-Za-z0-9])?$/u;
const CREDENTIAL_HELPER = "!f() { test \"$1\" = get || exit 0; echo username=x-access-token; echo password=$AGENTIC_GIT_TOKEN; }; f";

export async function createSmartGitLedgerCommit({
  ledgerRepository,
  ledgerRef,
  ledgerPath,
  snapshot,
  content,
  action,
  token = "",
  repositoryUrl = null,
  runGit = executeGit,
} = {}) {
  requireRepositoryName(ledgerRepository);
  requireLedgerRef(ledgerRef);
  requireLedgerPath(ledgerPath);
  requireSha(snapshot?.revision, "ledger revision");
  requireText(content, "ledger content");
  requireText(action, "ledger action");
  const remote = repositoryUrl || `https://github.com/${ledgerRepository}.git`;
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "agentic-ledger-smart-git-"));
  const repositoryRoot = path.join(temporaryRoot, "repository");
  const environment = token
    ? { ...process.env, AGENTIC_GIT_TOKEN: token }
    : process.env;
  const authentication = token
    ? ["-c", "credential.helper=", "-c", `credential.helper=${CREDENTIAL_HELPER}`]
    : [];
  const run = argumentsList => runGit(argumentsList, {
    cwd: repositoryRoot,
    environment,
  });
  try {
    runGit([
      ...authentication,
      "clone", "--quiet", "--depth=1", "--single-branch", "--branch", ledgerRef,
      remote, repositoryRoot,
    ], { environment });
    const observedRevision = run(["rev-parse", "HEAD"]);
    if (observedRevision !== snapshot.revision) {
      throw new Error("Collaboration ledger changed before smart Git preparation.");
    }
    const ledgerFile = path.resolve(repositoryRoot, ledgerPath);
    if (!ledgerFile.startsWith(`${repositoryRoot}${path.sep}`)) {
      throw new Error("Collaboration ledger path escaped the transport repository.");
    }
    await mkdir(path.dirname(ledgerFile), { recursive: true });
    await writeFile(ledgerFile, content, "utf8");
    run(["add", "--", ledgerPath]);
    run([
      "-c", "user.name=agentic-canvas-os",
      "-c", "user.email=agentic-canvas-os@users.noreply.github.com",
      "commit", "--quiet", "-m", `chore(collaboration): ${action} ledger transition`,
    ]);
    const commitSha = run(["rev-parse", "HEAD"]);
    const parentSha = run(["rev-parse", "HEAD^"]);
    const treeSha = run(["rev-parse", "HEAD^{tree}"]);
    requireSha(commitSha, "candidate ledger commit");
    requireSha(treeSha, "candidate ledger tree");
    if (parentSha !== snapshot.revision) {
      throw new Error("Smart Git ledger candidate did not preserve the exact parent revision.");
    }
    run([...authentication, "push", "--quiet", "origin", `HEAD:refs/heads/${ledgerRef}`]);
    return Object.freeze({ commitSha, treeSha });
  } finally {
    if (token) delete environment.AGENTIC_GIT_TOKEN;
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

function executeGit(argumentsList, { cwd, environment = process.env } = {}) {
  return execFileSync("git", argumentsList, {
    cwd,
    env: environment,
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function requireRepositoryName(value) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u.test(String(value || ""))) {
    throw new Error("ledgerRepository must be an owner/repository name.");
  }
}

function requireLedgerRef(value) {
  const ref = String(value || "");
  if (!LEDGER_REF_PATTERN.test(ref) || ref.includes("..") || ref.includes("//")) {
    throw new Error("ledgerRef must be a safe branch name.");
  }
}

function requireLedgerPath(value) {
  const candidate = String(value || "");
  if (!candidate || path.isAbsolute(candidate) || candidate.split("/").includes("..")) {
    throw new Error("ledgerPath must be a repository-relative path.");
  }
}

function requireSha(value, label) {
  if (!SHA_PATTERN.test(String(value || ""))) {
    throw new Error(`${label} must be a lowercase 40-character Git SHA.`);
  }
}

function requireText(value, label) {
  if (!String(value || "").trim()) throw new Error(`${label} is required.`);
}
