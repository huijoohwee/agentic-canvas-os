import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";

export const CHANGE_MANIFEST_SCHEMA = "agentic-change-manifest/v1";
export const DEVICE_INTEGRATION_RESULT_SCHEMA = "agentic-device-integration-result/v1";
const SHA_PATTERN = /^[0-9a-f]{40}$/;

export function integrateSession({
  invocationPath,
  repo,
  gitText,
  ghText,
  leaseStore,
  sessionId,
  run,
  runText,
  publishTask,
  completeTask,
  commitMessage = "",
  pathsManifest = "",
  runtime = "canonical",
  runtimeRepository = "",
  controllerRoot,
  waitSeconds = 900,
  pollSeconds = 5,
  now = () => new Date(),
  sleep = defaultSleep,
  log = console.log,
}) {
  requireRepositoryRoot({ invocationPath, repo });
  requireBounds({ waitSeconds, pollSeconds });
  if (!sessionId) throw new Error("Integration requires --session or AGENTIC_SESSION_ID.");
  if (!['canonical', 'none'].includes(runtime)) throw new Error("--runtime must be canonical or none.");

  let { branch, lease } = resolveIntegrationLease({ repo, gitText, leaseStore });
  if (lease.sessionId !== sessionId) throw new Error("Integration lease belongs to another session.");
  if (path.resolve(lease.worktreePath) !== path.resolve(repo)) {
    throw new Error(`Integration lease belongs to ${lease.worktreePath}, not ${repo}.`);
  }

  const canonicalRoot = resolveCanonicalMainWorktree(gitText(["worktree", "list", "--porcelain", "-z"]));
  let commitEvidence = lease.integration || null;
  if (lease.status === "active") {
    commitEvidence = prepareIntegrationCommit({
      branch, lease, repo, gitText, leaseStore, sessionId, run,
      commitMessage, pathsManifest, now,
    });
    refreshTaskBranchFromMain({ repo, gitText, run, runText });
    publishTask();
    lease = leaseStore.read(branch);
  } else if (!['delivery', 'completing', 'completed'].includes(lease.status)) {
    throw new Error(
      `Integration requires an active, delivery, completing, or completed lease; ${branch} is ${lease.status}. ` +
      "Resume review-ready work before protected integration.",
    );
  }

  let completion = lease.completion || null;
  if (!['completing', 'completed'].includes(lease.status)) {
    const pullRequest = waitForMergedPullRequest({
      url: lease.pullRequestUrl,
      expectedHeadSha: lease.deliveryHeadSha || commitEvidence?.commitSha,
      ghText, waitSeconds, pollSeconds, now, sleep,
    });
    log(`Protected pull request merged at ${pullRequest.mergeCommitSha.slice(0, 12)}.`);
    completion = completeTask();
    lease = leaseStore.read(branch);
  } else if (lease.status === "completing") {
    completion = completeTask();
    lease = leaseStore.read(branch);
  }
  if (lease.status === "completed") completion = lease.completion;
  const mainSha = completion?.mainSha;
  if (!SHA_PATTERN.test(String(mainSha || ""))) {
    throw new Error("Integration completion did not emit an exact canonical main SHA.");
  }

  const runtimeReadiness = runtime === "canonical"
    ? reconcileCanonicalRuntime({
      canonicalRoot,
      mainSha,
      controllerRoot,
      runtimeRepository,
      runText,
    })
    : null;
  const status = runtimeReadiness ? "runtime_ready" : "integrated";
  const result = {
    schema: DEVICE_INTEGRATION_RESULT_SCHEMA,
    ok: true,
    status,
    branch,
    worktreePath: repo,
    pullRequestUrl: lease.pullRequestUrl,
    commit: commitEvidence,
    mergeCommitSha: completion?.mergeCommitSha || null,
    mainSha,
    runtime: runtimeReadiness,
  };
  log(
    runtimeReadiness
      ? `Integrated ${branch} and verified canonical runtime ${mainSha.slice(0, 12)}.`
      : `Integrated ${branch} at canonical main ${mainSha.slice(0, 12)}; runtime reconciliation was explicitly disabled.`,
  );
  return result;
}

function refreshTaskBranchFromMain({ repo, gitText, run, runText }) {
  if (gitText(["status", "--porcelain"]).trim()) {
    throw new Error("Integration commit did not leave a clean task worktree.");
  }
  run("git", ["fetch", "origin", "main"]);
  runText("git", ["merge-tree", "--write-tree", "HEAD", "origin/main"], { cwd: repo });
  run("git", ["merge", "--no-edit", "origin/main"]);
  if (gitText(["status", "--porcelain"]).trim()) {
    throw new Error("Protected-main refresh did not leave a clean task worktree.");
  }
}

function prepareIntegrationCommit({
  branch, lease, repo, gitText, leaseStore, sessionId, run,
  commitMessage, pathsManifest, now,
}) {
  run("git", ["merge-base", "--is-ancestor", lease.fenceSha, "HEAD"]);
  const changedBeforeCheck = listChangedPaths(gitText);
  let manifest = null;
  if (changedBeforeCheck.length) {
    manifest = readChangeManifest({ filePath: pathsManifest, repo, branch, lease });
    requireExactPaths({ changed: changedBeforeCheck, approved: manifest.value.paths });
    requireCommitMessage(commitMessage);
    run("npm", ["run", "check"]);
    const changedAfterCheck = listChangedPaths(gitText);
    requireExactPaths({ changed: changedAfterCheck, approved: manifest.value.paths });
    run("git", ["add", "--", ...manifest.value.paths.map(value => `:(literal)${value}`)]);
    if (splitNul(gitText(["diff", "--name-only", "-z"])).length) {
      throw new Error("Validation left unstaged changes; integration stopped before commit.");
    }
    requireExactPaths({
      changed: splitNul(gitText(["diff", "--cached", "--name-only", "-z"])),
      approved: manifest.value.paths,
    });
    const stagedDiffDigest = sha256(gitText(["diff", "--cached", "--binary"]));
    run("git", ["commit", "-m", commitMessage]);
    return annotateIntegration({
      branch, leaseStore, sessionId, gitText, now,
      values: {
        commitMessage,
        manifestDigest: manifest.digest,
        stagedDiffDigest,
        paths: manifest.value.paths,
      },
    });
  }

  const headSha = gitText(["rev-parse", "HEAD"]).trim();
  if (headSha === lease.fenceSha && !lease.integration) {
    throw new Error("No authored or committed task change exists beyond the writer fence.");
  }
  if (lease.integration?.commitSha === headSha) return lease.integration;
  return annotateIntegration({
    branch, leaseStore, sessionId, gitText, now,
    values: {
      commitMessage: gitText(["log", "-1", "--pretty=%s"]).trim(),
      manifestDigest: null,
      stagedDiffDigest: null,
      paths: [],
    },
  });
}

function annotateIntegration({ branch, leaseStore, sessionId, gitText, now, values }) {
  const commitSha = gitText(["rev-parse", "HEAD"]).trim();
  const treeSha = gitText(["rev-parse", "HEAD^{tree}"]).trim();
  if (!SHA_PATTERN.test(commitSha) || !SHA_PATTERN.test(treeSha)) {
    throw new Error("Integration commit evidence requires exact commit and tree SHAs.");
  }
  const integration = {
    schema: "agentic-integration-commit/v1",
    commitSha,
    treeSha,
    ...values,
    recordedAt: now().toISOString(),
  };
  leaseStore.annotate({ sessionId, branch, values: { integration } });
  return integration;
}

function waitForMergedPullRequest({
  url, expectedHeadSha, ghText, waitSeconds, pollSeconds, now, sleep,
}) {
  if (!url) throw new Error("Integration requires the lease-owned pull request URL.");
  if (!SHA_PATTERN.test(String(expectedHeadSha || ""))) {
    throw new Error("Integration requires an exact delivered pull-request head SHA.");
  }
  const deadline = now().getTime() + waitSeconds * 1000;
  for (;;) {
    const pullRequest = JSON.parse(ghText([
      "pr", "view", url, "--json", "state,baseRefName,url,headRefOid,mergeCommit",
    ]));
    if (pullRequest.url !== url || pullRequest.baseRefName !== "main") {
      throw new Error(`Pull request identity for ${url} changed during integration.`);
    }
    if (pullRequest.headRefOid !== expectedHeadSha) {
      throw new Error(
        `Pull request head ${pullRequest.headRefOid || "unknown"} does not match delivered head ${expectedHeadSha}.`,
      );
    }
    if (pullRequest.state === "MERGED") {
      const mergeCommitSha = pullRequest.mergeCommit?.oid;
      if (!SHA_PATTERN.test(String(mergeCommitSha || ""))) {
        throw new Error(`Merged pull request ${url} has no exact merge commit SHA.`);
      }
      return { ...pullRequest, mergeCommitSha };
    }
    if (pullRequest.state !== "OPEN") {
      throw new Error(`Pull request ${url} is ${String(pullRequest.state || "unknown").toLowerCase()}, not merged.`);
    }
    if (now().getTime() >= deadline) {
      throw new Error(
        `Protected integration remains pending after ${waitSeconds}s at ${url}; the delivery lease is preserved for replay.`,
      );
    }
    sleep(Math.min(pollSeconds * 1000, Math.max(1, deadline - now().getTime())));
  }
}

function reconcileCanonicalRuntime({ canonicalRoot, mainSha, controllerRoot, runtimeRepository, runText }) {
  const controller = path.resolve(controllerRoot || "");
  if (!controllerRoot || !path.isAbsolute(controllerRoot)) {
    throw new Error("Canonical integration requires the absolute Agentic Canvas OS controller root.");
  }
  runText("node", [path.join(controller, "scripts", "live-sync.mjs")], { cwd: canonicalRoot });
  const integratedSha = String(runText("git", ["rev-parse", "HEAD"], { cwd: canonicalRoot })).trim();
  if (integratedSha !== mainSha) {
    throw new Error(`Canonical source ${canonicalRoot} did not converge to integrated main ${mainSha}.`);
  }

  const repositories = resolveRuntimeRepositories({ canonicalRoot, runtimeRepository });
  const output = runText("npm", [
    "--prefix", repositories.agenticCanvasOsRoot,
    "run", "turn:end", "--",
    `--repository=${repositories.knowgrphRoot}`,
    "--json",
  ]);
  const line = String(output || "").trim().split(/\r?\n/).reverse().find(value => value.trim().startsWith("{"));
  if (!line) throw new Error("Canonical runtime reconciler returned no machine-readable readiness result.");
  const result = JSON.parse(line);
  const integratedRepository = path.basename(canonicalRoot);
  const integratedRevision = integratedRepository === "agentic-canvas-os"
    ? result.agenticCanvasOs?.revision
    : integratedRepository === "knowgrph"
      ? result.source?.revision
      : null;
  if (result.schema !== "agentic-local-runtime-readiness/v1" || result.ready !== true ||
      result.status !== "runtime-ready" || integratedRevision !== mainSha) {
    throw new Error("Canonical runtime readiness did not match the integrated main SHA.");
  }
  return {
    integratedSource: { repository: integratedRepository, root: canonicalRoot, mainSha },
    readiness: result,
  };
}

function resolveRuntimeRepositories({ canonicalRoot, runtimeRepository }) {
  const integratedRepository = path.basename(canonicalRoot);
  if (!["agentic-canvas-os", "knowgrph"].includes(integratedRepository)) {
    throw new Error(`Unsupported canonical integration repository: ${canonicalRoot}`);
  }
  const workspaceRoot = path.dirname(canonicalRoot);
  const knowgrphRoot = runtimeRepository
    ? path.resolve(runtimeRepository)
    : integratedRepository === "knowgrph"
      ? canonicalRoot
      : path.join(workspaceRoot, "knowgrph");
  const agenticCanvasOsRoot = integratedRepository === "agentic-canvas-os"
    ? canonicalRoot
    : path.join(workspaceRoot, "agentic-canvas-os");
  for (const [label, candidate] of [["Agentic Canvas OS", agenticCanvasOsRoot], ["Knowgrph", knowgrphRoot]]) {
    try {
      JSON.parse(readFileSync(path.join(candidate, "package.json"), "utf8"));
    } catch {
      throw new Error(`${label} canonical repository is unavailable at ${candidate}.`);
    }
  }
  return { agenticCanvasOsRoot, knowgrphRoot };
}

function readChangeManifest({ filePath, repo, branch, lease }) {
  if (!filePath) throw new Error("Dirty integration requires --paths-manifest.");
  const absolutePath = path.resolve(filePath);
  const bytes = readFileSync(absolutePath);
  const value = JSON.parse(bytes.toString("utf8"));
  if (value?.schema !== CHANGE_MANIFEST_SCHEMA || value.branch !== branch || value.baseSha !== lease.baseSha ||
      !Array.isArray(value.paths) || value.paths.length === 0) {
    throw new Error(`Invalid ${CHANGE_MANIFEST_SCHEMA} at ${absolutePath}.`);
  }
  const normalizedPaths = value.paths.map(normalizeRepoPath);
  if (normalizedPaths.some((normalized, index) => normalized !== value.paths[index])) {
    throw new Error("Change manifest paths must already use normalized repository-relative spelling.");
  }
  const paths = [...new Set(normalizedPaths)].sort();
  if (paths.length !== value.paths.length) throw new Error("Change manifest paths must be unique and normalized.");
  return { value: { ...value, paths }, digest: sha256(bytes) };
}

function normalizeRepoPath(value) {
  const normalized = String(value || "").replaceAll("\\", "/").trim();
  if (!normalized || normalized.startsWith("/") || normalized === ".." || normalized.startsWith("../") ||
      normalized.includes("/../") || normalized.endsWith("/..") || normalized.startsWith("./")) {
    throw new Error(`Unsafe change-manifest path: ${value}`);
  }
  return normalized;
}

function listChangedPaths(gitText) {
  return [...new Set([
    ...splitNul(gitText(["diff", "--name-only", "-z", "HEAD", "--"])),
    ...splitNul(gitText(["ls-files", "--others", "--exclude-standard", "-z"])),
  ])].sort();
}

function requireExactPaths({ changed, approved }) {
  const actual = [...changed].sort();
  const expected = [...approved].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Changed paths do not match the approved manifest; changed=${actual.join(",") || "none"}; ` +
      `approved=${expected.join(",") || "none"}.`,
    );
  }
}

function resolveIntegrationLease({ repo, gitText, leaseStore }) {
  const attachedBranch = gitText(["branch", "--show-current"]).trim();
  if (attachedBranch) {
    const lease = leaseStore.read(attachedBranch);
    if (!lease) throw new Error(`No writer lease records ${attachedBranch}.`);
    return { branch: attachedBranch, lease };
  }
  const registry = leaseStore.read();
  const matches = Object.values(registry?.leases || {}).filter(lease =>
    ['completing', 'completed'].includes(lease?.status) && lease.worktreePath &&
    path.resolve(lease.worktreePath) === path.resolve(repo));
  if (matches.length !== 1) {
    throw new Error("Detached integration replay requires one exact completing or completed lease for this worktree.");
  }
  return { branch: matches[0].branch, lease: matches[0] };
}

function resolveCanonicalMainWorktree(porcelain) {
  const records = String(porcelain || "").split("\0\n").join("\0").split("\0\0").filter(Boolean);
  const matches = [];
  for (const record of records) {
    const fields = record.split("\0").filter(Boolean);
    const worktree = fields.find(field => field.startsWith("worktree "))?.slice(9);
    const branch = fields.find(field => field.startsWith("branch "))?.slice(7);
    if (worktree && branch === "refs/heads/main") matches.push(worktree);
  }
  if (matches.length !== 1) throw new Error("Integration requires exactly one registered canonical main worktree.");
  return path.resolve(matches[0]);
}

function requireCommitMessage(value) {
  const message = String(value || "").trim();
  if (!message || message.length > 200 || /[\r\n]/.test(message)) {
    throw new Error("Dirty integration requires one intentional single-line --commit-message of at most 200 characters.");
  }
}

function requireRepositoryRoot({ invocationPath, repo }) {
  if (path.resolve(invocationPath) !== path.resolve(repo)) {
    throw new Error(`Integration must start at the registered worktree root ${repo}.`);
  }
}

function requireBounds({ waitSeconds, pollSeconds }) {
  if (!Number.isFinite(waitSeconds) || waitSeconds < 1 || waitSeconds > 3600) {
    throw new Error("--wait-seconds must be between 1 and 3600.");
  }
  if (!Number.isFinite(pollSeconds) || pollSeconds < 0.1 || pollSeconds > 60) {
    throw new Error("--poll-seconds must be between 0.1 and 60.");
  }
}

function splitNul(value) {
  return String(value || "").split("\0").map(item => item.trim()).filter(Boolean);
}

function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

function defaultSleep(milliseconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, milliseconds);
}
